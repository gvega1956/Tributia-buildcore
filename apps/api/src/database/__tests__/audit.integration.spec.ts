/**
 * PRUEBAS DE AUDITORÍA E INMUTABILIDAD — Sesión 4 Capa 0
 *
 * Verifican las propiedades del sistema de auditoría (P8):
 *
 *   1. Un INSERT en tabla auditada genera entrada en audit_log con datos_nuevos correctos.
 *   2. Un UPDATE genera entrada con datos_anteriores, datos_nuevos y diff (solo campos cambiados).
 *   3. El diff contiene EXACTAMENTE los campos modificados, no más.
 *   4. Un DELETE físico en tabla protegida es rechazado (RAISE EXCEPTION).
 *   5. El audit_log captura usuario_id desde app.current_user_id.
 *   6. tributia_app no puede insertar directamente en audit_log (solo SELECT).
 *   7. Soft-delete (activo = false) genera entrada en audit_log como UPDATE.
 *
 * Requieren Docker corriendo: `docker compose up -d postgres`
 * Requieren las tres migraciones aplicadas: 0000_tenancy, 0001_identidad, 0002_auditoria.
 * Correr con: pnpm --filter @tributia/api test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID, softDeleteValues } from '@tributia/shared';

// ─── Conexiones ──────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

// ─── Helper: ejecutar como tributia_app con contexto de auditoría ─────────────
async function runAsApp<T>(
  appPool: Pool,
  ctx: { tenantId: string; userId?: string; ip?: string; ua?: string },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id       = '${ctx.tenantId}'`);
    await client.query(`SET LOCAL app.current_user_id = '${ctx.userId ?? ''}'`);
    await client.query(`SET LOCAL app.client_ip       = '${ctx.ip ?? '127.0.0.1'}'`);
    await client.query(`SET LOCAL app.user_agent      = '${ctx.ua ?? 'test-agent'}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe('Auditoría e inmutabilidad (P8)', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  let tenantId: string;
  let empresaId: string;
  let usuarioId: string;
  const fakeUserId = newId();

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool   = new Pool({ connectionString: APP_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantId  = newId();
    empresaId = newId();
    usuarioId = newId();

    await adminDb.insert(schema.tenants).values({
      id: tenantId,
      nombre: 'Constructora Audit [test]',
      slug: `test-audit-${tenantId.slice(0, 8)}`,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await adminDb.insert(schema.empresas).values({
      id: empresaId,
      tenantId,
      nombre: 'Empresa Audit [test]',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await adminDb.insert(schema.usuarios).values({
      id: usuarioId,
      tenantId,
      email: `audit-test@${tenantId.slice(0, 8)}.com`,
      passwordHash: 'hash-placeholder',
      nombre: 'Audit',
      apellido: 'Test',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
  });

  afterAll(async () => {
    // Limpiar en orden inverso a FK — audit_log se limpia automáticamente
    // porque no tiene FK hacia los registros de test (solo registroId como UUID).
    await adminDb.delete(schema.usuarios).where(eq(schema.usuarios.id, usuarioId));
    await adminDb.delete(schema.empresas).where(eq(schema.empresas.id, empresaId));
    await adminDb.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await adminPool.end();
    await appPool.end();
  });

  // ─── 1. INSERT auditado ───────────────────────────────────────────────────
  it('INSERT en empresa genera entrada audit_log con datos_nuevos', async () => {
    const empId = newId();

    await adminDb.insert(schema.empresas).values({
      id: empId,
      tenantId,
      nombre: 'Empresa INSERT Auditada',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    const [entry] = await adminDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.tablaNombre, 'empresa'),
          eq(schema.auditLogs.registroId, empId),
          eq(schema.auditLogs.operacion, 'INSERT'),
        ),
      )
      .limit(1);

    expect(entry).toBeDefined();
    expect(entry?.operacion).toBe('INSERT');
    expect(entry?.datosNuevos).toMatchObject({ id: empId, nombre: 'Empresa INSERT Auditada' });
    expect(entry?.datosAnteriores).toBeNull();

    // Limpieza (prevent_delete protege la tabla — deshabilitar trigger solo en tests)
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE id = $1`, [empId]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
  });

  // ─── 2. UPDATE auditado con diff correcto ────────────────────────────────
  it('UPDATE en usuario genera diff con SOLO los campos cambiados', async () => {
    const nombreOriginal  = 'NombreOriginal';
    const nombreNuevo     = 'NombreModificado';

    // Crear usuario de prueba (como admin para evitar RLS en setup)
    const uid = newId();
    await adminDb.insert(schema.usuarios).values({
      id: uid,
      tenantId,
      email: `diff-test-${uid.slice(0, 8)}@test.com`,
      passwordHash: 'hash',
      nombre: nombreOriginal,
      apellido: 'Apellido',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // Hacer el UPDATE como tributia_app (con contexto de auditoría)
    await runAsApp(appPool, { tenantId, userId: fakeUserId }, async (client) => {
      await client.query(
        `UPDATE usuario SET nombre = $1, updated_by = $2 WHERE id = $3`,
        [nombreNuevo, fakeUserId, uid],
      );
    });

    // Buscar la entrada de auditoría
    const entries = await adminDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.tablaNombre, 'usuario'),
          eq(schema.auditLogs.registroId, uid),
          eq(schema.auditLogs.operacion, 'UPDATE'),
        ),
      );

    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0]!;

    // Verificar datos anteriores y nuevos
    expect((entry.datosAnteriores as Record<string, unknown>)['nombre']).toBe(nombreOriginal);
    expect((entry.datosNuevos as Record<string, unknown>)['nombre']).toBe(nombreNuevo);

    // Verificar diff: debe contener 'nombre' y 'updated_by' pero NO 'apellido' (no cambió)
    const diff = entry.diff as Record<string, unknown>;
    expect(diff).toHaveProperty('nombre', nombreNuevo);
    expect(diff).toHaveProperty('updated_by');
    expect(diff).not.toHaveProperty('apellido');
    expect(diff).not.toHaveProperty('email');

    // Verificar que capturó el usuario que hizo el cambio
    expect(entry.usuarioId).toBe(fakeUserId);

    // Limpieza (prevent_delete protege la tabla — deshabilitar trigger solo en tests)
    await adminPool.query(`ALTER TABLE usuario DISABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`DELETE FROM usuario WHERE id = $1`, [uid]);
    await adminPool.query(`ALTER TABLE usuario ENABLE TRIGGER no_delete_usuario`);
  });

  // ─── 3. DELETE físico rechazado en tabla protegida ───────────────────────
  it('DELETE físico en usuario es rechazado por prevent_delete trigger', async () => {
    const uid = newId();
    await adminDb.insert(schema.usuarios).values({
      id: uid,
      tenantId,
      email: `nodelete-${uid.slice(0, 8)}@test.com`,
      passwordHash: 'hash',
      nombre: 'No',
      apellido: 'Borrable',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // Intentar DELETE físico como admin (el trigger prevent_delete no distingue usuario)
    await expect(
      adminPool.query(`DELETE FROM usuario WHERE id = $1`, [uid]),
    ).rejects.toThrow(/Borrado físico no permitido/);

    // El registro debe seguir existiendo
    const [still] = await adminDb
      .select()
      .from(schema.usuarios)
      .where(eq(schema.usuarios.id, uid));
    expect(still).toBeDefined();

    // Limpieza: usar soft-delete (activo = false) y luego hacerlo manualmente
    // como workaround ya que prevent_delete lo protege.
    // En producción no hay "limpieza" — soft-delete es el camino.
    // En tests, deshabilitamos el trigger temporalmente.
    await adminPool.query(`ALTER TABLE usuario DISABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`DELETE FROM usuario WHERE id = $1`, [uid]);
    await adminPool.query(`ALTER TABLE usuario ENABLE TRIGGER no_delete_usuario`);
  });

  // ─── 4. DELETE físico rechazado en empresa ───────────────────────────────
  it('DELETE físico en empresa es rechazado por prevent_delete trigger', async () => {
    const eid = newId();
    await adminDb.insert(schema.empresas).values({
      id: eid,
      tenantId,
      nombre: 'Empresa No Borrable',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await expect(
      adminPool.query(`DELETE FROM empresa WHERE id = $1`, [eid]),
    ).rejects.toThrow(/Borrado físico no permitido/);

    // Limpieza (disable trigger temporalmente en tests)
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE id = $1`, [eid]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
  });

  // ─── 5. Soft-delete genera entrada UPDATE en audit_log ───────────────────
  it('Soft-delete (activo = false) genera entrada UPDATE en audit_log', async () => {
    const uid = newId();
    await adminDb.insert(schema.usuarios).values({
      id: uid,
      tenantId,
      email: `softdel-${uid.slice(0, 8)}@test.com`,
      passwordHash: 'hash',
      nombre: 'Para',
      apellido: 'SoftDelete',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // Soft-delete usando la utilidad compartida + RLS context
    await runAsApp(appPool, { tenantId, userId: fakeUserId }, async (client) => {
      const vals = softDeleteValues(fakeUserId);
      await client.query(
        `UPDATE usuario SET activo = false, updated_at = $1, updated_by = $2 WHERE id = $3`,
        [vals.deletedAt, fakeUserId, uid],
      );
    });

    const [entry] = await adminDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.tablaNombre, 'usuario'),
          eq(schema.auditLogs.registroId, uid),
          eq(schema.auditLogs.operacion, 'UPDATE'),
        ),
      )
      .limit(1);

    expect(entry).toBeDefined();
    const diff = entry?.diff as Record<string, unknown>;
    expect(diff).toHaveProperty('activo', false);

    // El registro sigue en BD (no se borró)
    const [still] = await adminDb
      .select()
      .from(schema.usuarios)
      .where(eq(schema.usuarios.id, uid));
    expect(still).toBeDefined();
    expect(still?.activo).toBe(false);

    // Limpieza
    await adminPool.query(`ALTER TABLE usuario DISABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`DELETE FROM usuario WHERE id = $1`, [uid]);
    await adminPool.query(`ALTER TABLE usuario ENABLE TRIGGER no_delete_usuario`);
  });

  // ─── 6. tributia_app no puede insertar en audit_log ──────────────────────
  it('tributia_app no puede insertar directamente en audit_log', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query(
          `INSERT INTO audit_log (id, tabla_nombre, registro_id, operacion)
           VALUES (gen_random_uuid(), 'usuario', gen_random_uuid(), 'INSERT')`,
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // ─── 7. audit_log captura IP y user-agent ────────────────────────────────
  it('audit_log captura ip_address y user_agent del contexto de sesión', async () => {
    const uid = newId();
    await adminDb.insert(schema.usuarios).values({
      id: uid,
      tenantId,
      email: `ctx-test-${uid.slice(0, 8)}@test.com`,
      passwordHash: 'hash',
      nombre: 'Contexto',
      apellido: 'Test',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    const testIp    = '192.168.1.100';
    const testAgent = 'Mozilla/5.0 (Test Runner)';

    await runAsApp(
      appPool,
      { tenantId, userId: fakeUserId, ip: testIp, ua: testAgent },
      async (client) => {
        await client.query(
          `UPDATE usuario SET nombre = 'ContextoModificado', updated_by = $1 WHERE id = $2`,
          [fakeUserId, uid],
        );
      },
    );

    const [entry] = await adminDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.registroId, uid),
          eq(schema.auditLogs.operacion, 'UPDATE'),
        ),
      )
      .limit(1);

    expect(entry?.ipAddress).toBe(testIp);
    expect(entry?.userAgent).toBe(testAgent);

    // Limpieza
    await adminPool.query(`ALTER TABLE usuario DISABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`DELETE FROM usuario WHERE id = $1`, [uid]);
    await adminPool.query(`ALTER TABLE usuario ENABLE TRIGGER no_delete_usuario`);
  });
});
