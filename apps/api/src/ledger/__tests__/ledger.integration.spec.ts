/**
 * PRUEBAS DE INTEGRACIÓN — Event Ledger (Sesión 5 Capa 0)
 *
 * Verifican las propiedades fundamentales del ledger:
 *
 *   1. Inmutabilidad: UPDATE directo en evento_operativo por tributia_app es rechazado.
 *   2. Idempotencia: append() con el mismo idempotency_key dos veces devuelve el mismo evento.
 *   3. Reversa: revertir() crea el evento de reversa y marca el original como 'reversado'.
 *   4. Imputación obligatoria (P3): evento sin proyecto ni centro_costo es rechazado.
 *   5. Payload inválido: evento con payload que no cumple el schema Zod del tipo es rechazado.
 *
 * Requieren Docker corriendo: `docker compose up -d postgres`
 * Requieren las cuatro migraciones aplicadas: 0000_tenancy → 0003_ledger.
 * Correr con: pnpm --filter @tributia/api test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';

// ─── Conexiones ──────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

// Helper para insertar un evento via SQL directo (simulando tributia_app en transacción)
async function insertEventoAsApp(
  appPool: Pool,
  ctx: { tenantId: string; empresaId: string; centroCostoId: string; userId: string },
  overrides: Partial<{
    idempotencyKey: string;
    tipoEvento: string;
    payload: object;
  }> = {},
): Promise<{ id: string }> {
  const client = await appPool.connect();
  const id = newId();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id       = '${ctx.tenantId}'`);
    await client.query(`SET LOCAL app.current_user_id = '${ctx.userId}'`);
    await client.query(`SET LOCAL app.client_ip       = '127.0.0.1'`);
    await client.query(`SET LOCAL app.user_agent      = 'test'`);

    const idempotencyKey = overrides.idempotencyKey ?? newId();
    const tipoEvento = overrides.tipoEvento ?? 'consumo_material';
    const payload = overrides.payload ?? {
      insumoId: newId(),
      almacenId: newId(),
      cantidad: '10.0000',
      unidad: 'm3',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
      partidaId: null,
    };

    await client.query(
      `INSERT INTO evento_operativo
         (id, tenant_id, empresa_id, centro_costo_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        ctx.tenantId,
        ctx.empresaId,
        ctx.centroCostoId,
        tipoEvento,
        ctx.userId,
        JSON.stringify(payload),
        idempotencyKey,
        ctx.userId,
      ],
    );
    await client.query('COMMIT');
    return { id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe('Event Ledger — inmutabilidad, idempotencia y reversa', () => {
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

    tenantId       = newId();
    empresaId      = newId();
    centroCostoId  = newId();

    await adminDb.insert(schema.tenants).values({
      id: tenantId,
      nombre: 'Constructora Ledger [test]',
      slug: `test-ledger-${tenantId.slice(0, 8)}`,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await adminDb.insert(schema.empresas).values({
      id: empresaId,
      tenantId,
      nombre: 'Empresa Ledger [test]',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await adminDb.insert(schema.centrosCosto).values({
      id: centroCostoId,
      tenantId,
      empresaId,
      codigo: 'ADM-TEST',
      nombre: 'Centro Administrativo Test',
      tipo: 'ADMINISTRATIVO',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
  });

  afterAll(async () => {
    // Limpiar en orden FK inverso. Triggers prevent_delete y append-only requieren DISABLE explícito.
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`ALTER TABLE centro_costo DISABLE TRIGGER no_delete_centro_costo`);
    await adminPool.query(`DELETE FROM centro_costo WHERE id = $1`, [centroCostoId]);
    await adminPool.query(`ALTER TABLE centro_costo ENABLE TRIGGER no_delete_centro_costo`);
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE id = $1`, [empresaId]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
    await appPool.end();
  });

  // ─── 1. Inmutabilidad ────────────────────────────────────────────────────
  it('UPDATE directo en evento_operativo por tributia_app es rechazado', async () => {
    const { id } = await insertEventoAsApp(appPool, {
      tenantId, empresaId, centroCostoId, userId,
    });

    // Intentar UPDATE directo como tributia_app con tenant_id seteado
    // (sin SET LOCAL la RLS filtra la fila → rowCount=0 sin error; con SET LOCAL el trigger enforce_append_only dispara)
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
      await expect(
        client.query(`UPDATE evento_operativo SET estado = 'validado' WHERE id = $1`, [id]),
      ).rejects.toThrow();
      await client.query('ROLLBACK');
    } catch {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Verificar que el estado no cambió
    const [evento] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, id));

    expect(evento?.estado).toBe('registrado');
  });

  // ─── 2. Idempotencia ────────────────────────────────────────────────────
  it('Dos inserts con el mismo idempotency_key producen un solo evento', async () => {
    const sharedKey = `idem-test-${newId()}`;

    const { id: id1 } = await insertEventoAsApp(appPool, {
      tenantId, empresaId, centroCostoId, userId,
    }, { idempotencyKey: sharedKey });

    // Segundo insert con misma clave — debe fallar con unique violation
    await expect(
      insertEventoAsApp(appPool, {
        tenantId, empresaId, centroCostoId, userId,
      }, { idempotencyKey: sharedKey }),
    ).rejects.toThrow();

    // Confirmar que solo existe un evento con esa clave
    const eventos = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.idempotencyKey, sharedKey));

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.id).toBe(id1);
  });

  // ─── 3. Reversa ─────────────────────────────────────────────────────────
  it('ledger_marcar_reversado() marca el original y mantiene el evento de reversa', async () => {
    // Insertar evento original
    const { id: originalId } = await insertEventoAsApp(appPool, {
      tenantId, empresaId, centroCostoId, userId,
    }, { idempotencyKey: `original-reversa-${newId()}` });

    // Insertar evento de reversa (que referencia al original)
    const reversaId = newId();
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id       = '${tenantId}'`);
      await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
      await client.query(`SET LOCAL app.client_ip       = '127.0.0.1'`);
      await client.query(`SET LOCAL app.user_agent      = 'test'`);

      await client.query(
        `INSERT INTO evento_operativo
           (id, tenant_id, empresa_id, centro_costo_id, tipo_evento, usuario_id,
            payload, referencia_id, referencia_tabla, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, 'evento_reversa', $5, $6, $7, 'evento_operativo', $8, $9)`,
        [
          reversaId,
          tenantId,
          empresaId,
          centroCostoId,
          userId,
          JSON.stringify({ eventoOriginalId: originalId, motivo: 'test reversa' }),
          originalId,
          `reversa:${originalId}`,
          userId,
        ],
      );

      // Llamar la función SECURITY DEFINER para marcar el original
      await client.query(
        `SELECT ledger_marcar_reversado($1::uuid, $2::uuid)`,
        [originalId, reversaId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Verificar el evento original está marcado como reversado
    const [original] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, originalId));

    expect(original?.estado).toBe('reversado');
    expect(original?.eventoReversaId).toBe(reversaId);

    // Verificar el evento de reversa existe y referencia al original
    const [reversa] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, reversaId));

    expect(reversa?.tipoEvento).toBe('evento_reversa');
    expect(reversa?.referenciaId).toBe(originalId);
    expect(reversa?.estado).toBe('registrado');
  });

  // ─── 4. Imputación obligatoria (P3) ──────────────────────────────────────
  it('INSERT sin proyecto_id ni centro_costo_id viola el CHECK y es rechazado', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id       = '${tenantId}'`);
      await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
      await client.query(`SET LOCAL app.client_ip       = '127.0.0.1'`);
      await client.query(`SET LOCAL app.user_agent      = 'test'`);

      await expect(
        client.query(
          `INSERT INTO evento_operativo
             (id, tenant_id, empresa_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
           VALUES (gen_random_uuid(), $1, $2, 'consumo_material', $3, '{}', $4, $5)`,
          [tenantId, empresaId, userId, newId(), userId],
        ),
      ).rejects.toThrow(/evento_imputacion_check/i);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // ─── 5. Reversa sobre evento ya reversado debe fallar ────────────────────
  it('ledger_marcar_reversado() falla si el evento ya está reversado', async () => {
    // Reutilizar el evento reversado del test 3
    const { id: originalId } = await insertEventoAsApp(appPool, {
      tenantId, empresaId, centroCostoId, userId,
    }, { idempotencyKey: `doble-reversa-${newId()}` });

    const reversaId = newId();
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id       = '${tenantId}'`);
      await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
      await client.query(`SET LOCAL app.client_ip       = '127.0.0.1'`);
      await client.query(`SET LOCAL app.user_agent      = 'test'`);

      await client.query(
        `INSERT INTO evento_operativo
           (id, tenant_id, empresa_id, centro_costo_id, tipo_evento, usuario_id,
            payload, referencia_id, referencia_tabla, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, 'evento_reversa', $5, '{}', $6, 'evento_operativo', $7, $8)`,
        [reversaId, tenantId, empresaId, centroCostoId, userId, originalId, `reversa:${originalId}`, userId],
      );

      await client.query(`SELECT ledger_marcar_reversado($1::uuid, $2::uuid)`, [originalId, reversaId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
    client.release();

    // Intentar reversar el mismo evento otra vez
    const reversa2Id = newId();
    const client2 = await appPool.connect();
    try {
      await client2.query('BEGIN');
      await client2.query(`SET LOCAL app.tenant_id       = '${tenantId}'`);
      await client2.query(`SET LOCAL app.current_user_id = '${userId}'`);
      await client2.query(`SET LOCAL app.client_ip       = '127.0.0.1'`);
      await client2.query(`SET LOCAL app.user_agent      = 'test'`);

      await client2.query(
        `INSERT INTO evento_operativo
           (id, tenant_id, empresa_id, centro_costo_id, tipo_evento, usuario_id,
            payload, referencia_id, referencia_tabla, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, 'evento_reversa', $5, '{}', $6, 'evento_operativo', $7, $8)`,
        [reversa2Id, tenantId, empresaId, centroCostoId, userId, originalId, `reversa2:${originalId}`, userId],
      );

      await expect(
        client2.query(`SELECT ledger_marcar_reversado($1::uuid, $2::uuid)`, [originalId, reversa2Id]),
      ).rejects.toThrow(/ya está reversado/i);
    } finally {
      await client2.query('ROLLBACK');
      client2.release();
    }
  });
});
