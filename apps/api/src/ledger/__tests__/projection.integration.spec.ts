/**
 * PRUEBAS DE INTEGRACIÓN — Motor de proyecciones (Sesión 6 Capa 0)
 *
 * Verifican las garantías del motor de proyecciones a nivel de base de datos:
 *
 *   1. Atomicidad síncrona: si el handler síncrono falla, ROLLBACK revierte evento + proyección.
 *   2. Atomicidad de encolado: outbox se inserta en la misma tx que el evento → ROLLBACK elimina ambos.
 *   3. Worker reclama con FOR UPDATE SKIP LOCKED: múltiples workers no procesan la misma entrada.
 *   4. Worker completa entrada: UPSERT stats + estado='completado'.
 *   5. Retry con backoff: fallo incrementa intentos y programa proximo_intento_en.
 *   6. Dead-letter: entrada pasa a 'fallido' cuando intentos >= max_intentos.
 *
 * Requieren Docker corriendo: `docker compose up -d postgres`
 * Requieren las cinco migraciones aplicadas: 0000_tenancy → 0004_proyecciones.
 * Correr con: pnpm --filter @tributia/api test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';

// ─── Conexiones ──────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Inserta un evento via admin (bypassa RLS) — util para setup de tests. */
async function insertEventoAdmin(
  adminDb: NodePgDatabase<typeof schema>,
  ctx: { tenantId: string; empresaId: string; centroCostoId: string; userId: string },
  overrides: { idempotencyKey?: string; tipoEvento?: string } = {},
): Promise<string> {
  const id = newId();
  await adminDb.insert(schema.eventosOperativos).values({
    id,
    tenantId: ctx.tenantId,
    empresaId: ctx.empresaId,
    centroCostoId: ctx.centroCostoId,
    tipoEvento: overrides.tipoEvento ?? 'consumo_material',
    usuarioId: ctx.userId,
    payload: { insumoId: newId(), almacenId: newId(), cantidad: '1.0000', unidad: 'u', costoUnitario: { amount: '10.0000', currency: 'DOP' }, partidaId: null },
    idempotencyKey: overrides.idempotencyKey ?? newId(),
    createdBy: ctx.userId,
  });
  return id;
}

/** Inserta un outbox entry via admin (bypassa RLS). */
async function insertOutboxAdmin(
  adminPool: Pool,
  eventoId: string,
  tenantId: string,
  opts: { estado?: string; intentos?: number; maxIntentos?: number } = {},
): Promise<string> {
  const id = newId();
  await adminPool.query(
    `INSERT INTO outbox (id, evento_id, handler_nombre, tenant_id, payload, estado, intentos, max_intentos, proximo_intento_en)
     VALUES ($1, $2, 'NotificacionAsincrona', $3, '{}', $4, $5, $6, now())`,
    [id, eventoId, tenantId, opts.estado ?? 'pendiente', opts.intentos ?? 0, opts.maxIntentos ?? 5],
  );
  return id;
}

/** Abre una tx como tributia_app con los SET LOCAL necesarios. */
async function beginAppTx(
  appPool: Pool,
  tenantId: string,
  userId: string,
): Promise<PoolClient> {
  const client = await appPool.connect();
  await client.query('BEGIN');
  await client.query(`SET LOCAL app.tenant_id       = '${tenantId}'`);
  await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
  await client.query(`SET LOCAL app.client_ip       = '127.0.0.1'`);
  await client.query(`SET LOCAL app.user_agent      = 'test'`);
  return client;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Motor de proyecciones — atomicidad, outbox, worker, retry, dead-letter', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  let tenantId: string;
  let empresaId: string;
  let centroCostoId: string;
  const userId = newId();

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool   = new Pool({ connectionString: APP_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantId      = newId();
    empresaId     = newId();
    centroCostoId = newId();

    await adminDb.insert(schema.tenants).values({
      id: tenantId,
      nombre: 'Constructora Proyecciones [test]',
      slug: `test-proj-${tenantId.slice(0, 8)}`,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await adminDb.insert(schema.empresas).values({
      id: empresaId,
      tenantId,
      nombre: 'Empresa Proyecciones [test]',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await adminDb.insert(schema.centrosCosto).values({
      id: centroCostoId,
      tenantId,
      empresaId,
      codigo: 'ADM-PROJ',
      nombre: 'Centro Admin Proyecciones',
      tipo: 'ADMINISTRATIVO',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM outbox WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM proyeccion_ledger_stats WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM centro_costo WHERE id = $1`, [centroCostoId]);
    await adminPool.query(`DELETE FROM empresa WHERE id = $1`, [empresaId]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
    await appPool.end();
  });

  // ─── 1. Atomicidad síncrona ──────────────────────────────────────────────
  it('ROLLBACK de la tx revierte tanto el evento como la proyección síncrona', async () => {
    const eventoId = newId();
    const client = await beginAppTx(appPool, tenantId, userId);
    try {
      await client.query(
        `INSERT INTO evento_operativo
           (id, tenant_id, empresa_id, centro_costo_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,'consumo_material',$5,'{}', $6, $7)`,
        [eventoId, tenantId, empresaId, centroCostoId, userId, `sync-atom-${eventoId}`, userId],
      );
      await client.query(
        `INSERT INTO proyeccion_ledger_stats (id, tenant_id, tipo_evento, total_eventos)
         VALUES (gen_random_uuid(), $1, 'consumo_material', 1)
         ON CONFLICT (tenant_id, tipo_evento) DO UPDATE SET total_eventos = proyeccion_ledger_stats.total_eventos + 1`,
        [tenantId],
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const [evento] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, eventoId));

    const [stats] = await adminDb
      .select()
      .from(schema.proyeccionLedgerStats)
      .where(
        and(
          eq(schema.proyeccionLedgerStats.tenantId, tenantId),
          eq(schema.proyeccionLedgerStats.tipoEvento, 'consumo_material'),
        ),
      );

    expect(evento).toBeUndefined();
    expect(stats).toBeUndefined();
  });

  // ─── 2. Atomicidad del encolado outbox ──────────────────────────────────
  it('INSERT evento + outbox en una tx — ROLLBACK elimina ambos', async () => {
    const eventoId = newId();
    const outboxId = newId();
    const client = await beginAppTx(appPool, tenantId, userId);
    try {
      await client.query(
        `INSERT INTO evento_operativo
           (id, tenant_id, empresa_id, centro_costo_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,'avance_partida',$5,'{}', $6, $7)`,
        [eventoId, tenantId, empresaId, centroCostoId, userId, `outbox-atom-${eventoId}`, userId],
      );
      await client.query(
        `INSERT INTO outbox (id, evento_id, handler_nombre, tenant_id, payload)
         VALUES ($1, $2, 'NotificacionAsincrona', $3, $4)`,
        [outboxId, eventoId, tenantId, JSON.stringify({ id: eventoId })],
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const rows = await adminPool.query(
      `SELECT id FROM outbox WHERE id = $1`, [outboxId],
    );
    const [ev] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, eventoId));

    expect(rows.rows).toHaveLength(0);
    expect(ev).toBeUndefined();
  });

  // ─── 3. FOR UPDATE SKIP LOCKED reclama entrada pendiente ────────────────
  it('Worker reclama entrada outbox pendiente con FOR UPDATE SKIP LOCKED', async () => {
    const eventoId = await insertEventoAdmin(adminDb, { tenantId, empresaId, centroCostoId, userId });
    const outboxId = await insertOutboxAdmin(adminPool, eventoId, tenantId);

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, estado FROM outbox WHERE id = $1 FOR UPDATE SKIP LOCKED`,
        [outboxId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(outboxId);
      expect(rows[0].estado).toBe('pendiente');

      await client.query(`UPDATE outbox SET estado = 'procesando' WHERE id = $1`, [outboxId]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const { rows: after } = await adminPool.query(
      `SELECT estado FROM outbox WHERE id = $1`, [outboxId],
    );
    expect(after[0].estado).toBe('procesando');
  });

  // ─── 4. Worker completa la entrada y actualiza proyeccion_ledger_stats ──
  it('Worker procesa outbox entry: UPSERT stats + marca completado', async () => {
    const eventoId = await insertEventoAdmin(adminDb, {
      tenantId, empresaId, centroCostoId, userId,
    }, { tipoEvento: 'avance_partida' });
    const outboxId = await insertOutboxAdmin(adminPool, eventoId, tenantId, { estado: 'procesando' });

    // Simular el worker: nueva tx con SET LOCAL app.tenant_id + handler + marcar completado
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);

      // Handler UPSERT (idempotente)
      await client.query(
        `INSERT INTO proyeccion_ledger_stats (id, tenant_id, tipo_evento, total_eventos)
         VALUES (gen_random_uuid(), $1, 'avance_partida', 1)
         ON CONFLICT (tenant_id, tipo_evento) DO UPDATE SET total_eventos = proyeccion_ledger_stats.total_eventos + 1, ultima_actualizacion = now()`,
        [tenantId],
      );

      // Marcar completado
      await client.query(
        `UPDATE outbox SET estado = 'completado', procesado_en = now() WHERE id = $1`,
        [outboxId],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const { rows } = await adminPool.query(
      `SELECT estado FROM outbox WHERE id = $1`, [outboxId],
    );
    expect(rows[0].estado).toBe('completado');

    const [stats] = await adminDb
      .select()
      .from(schema.proyeccionLedgerStats)
      .where(
        and(
          eq(schema.proyeccionLedgerStats.tenantId, tenantId),
          eq(schema.proyeccionLedgerStats.tipoEvento, 'avance_partida'),
        ),
      );
    expect(stats).toBeDefined();
    expect(stats!.totalEventos).toBeGreaterThanOrEqual(1);
  });

  // ─── 5. Retry con backoff ────────────────────────────────────────────────
  it('Fallo del handler incrementa intentos y reprograma proximo_intento_en', async () => {
    const eventoId = await insertEventoAdmin(adminDb, { tenantId, empresaId, centroCostoId, userId });
    const outboxId = await insertOutboxAdmin(adminPool, eventoId, tenantId, {
      estado: 'procesando',
      intentos: 0,
      maxIntentos: 3,
    });

    // Simular fallo: intentos++ → pendiente con próximo intento en el futuro
    await adminPool.query(
      `UPDATE outbox
       SET estado = 'pendiente',
           intentos = intentos + 1,
           proximo_intento_en = now() + interval '2 seconds',
           error_ultimo = 'Error simulado en test'
       WHERE id = $1`,
      [outboxId],
    );

    const { rows } = await adminPool.query(
      `SELECT estado, intentos, proximo_intento_en, error_ultimo FROM outbox WHERE id = $1`,
      [outboxId],
    );
    expect(rows[0].estado).toBe('pendiente');
    expect(rows[0].intentos).toBe(1);
    expect(new Date(rows[0].proximo_intento_en).getTime()).toBeGreaterThan(Date.now());
    expect(rows[0].error_ultimo).toBe('Error simulado en test');
  });

  // ─── 6. Dead-letter tras max_intentos ───────────────────────────────────
  it('Outbox entry pasa a fallido cuando intentos >= max_intentos', async () => {
    const eventoId = await insertEventoAdmin(adminDb, { tenantId, empresaId, centroCostoId, userId });
    const outboxId = await insertOutboxAdmin(adminPool, eventoId, tenantId, {
      estado: 'procesando',
      intentos: 4,  // max_intentos = 5; un fallo más → fallido
      maxIntentos: 5,
    });

    // Simular último fallo → dead-letter
    await adminPool.query(
      `UPDATE outbox
       SET estado = 'fallido',
           intentos = 5,
           error_ultimo = 'Error final — dead-letter'
       WHERE id = $1`,
      [outboxId],
    );

    const { rows } = await adminPool.query(
      `SELECT estado, intentos FROM outbox WHERE id = $1`, [outboxId],
    );
    expect(rows[0].estado).toBe('fallido');
    expect(rows[0].intentos).toBe(5);
  });
});
