/**
 * PRUEBAS DE INTEGRACIÓN — Tercero (Catálogos maestros)
 *
 *   1. Crear tercero proveedor con RNC válido (9 dígitos).
 *   2. RLS: tenant A no ve terceros del tenant B.
 *   3. Duplicar RNC en el mismo tenant genera conflicto 23505.
 *   4. Soft-delete: el tercero desaparece de la lista activa.
 *   5. CHECK rol: insertar tercero sin ningún rol activo es rechazado por DB.
 *   6. Actualizar email y nombre comercial.
 *
 * Requiere: `docker compose up -d postgres` + migraciones 0000–0006 aplicadas.
 * Correr: pnpm --filter @tributia/api test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, isNull } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

async function runAsApp<T>(
  appPool: Pool,
  tenantId: string,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id       = '${tenantId}'`);
    await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
    await client.query(`SET LOCAL app.client_ip       = '127.0.0.1'`);
    await client.query(`SET LOCAL app.user_agent      = 'vitest'`);
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

describe('Tercero — integración (P4.2 + RLS)', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  let tenantA: string;
  let tenantB: string;
  const userId = newId();
  const RNC_DEMO = '101000011'; // 9 dígitos

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool   = new Pool({ connectionString: APP_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantA = newId();
    tenantB = newId();

    await adminDb.insert(schema.tenants).values([
      { id: tenantA, nombre: 'Tenant A [tercero-test]', slug: `tercero-a-${tenantA.slice(0, 6)}`, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
      { id: tenantB, nombre: 'Tenant B [tercero-test]', slug: `tercero-b-${tenantB.slice(0, 6)}`, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
    ]);
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id IN ($1,$2)`, [tenantA, tenantB]);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id IN ($1,$2)`, [tenantA, tenantB]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id IN ($1,$2)`, [tenantA, tenantB]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
    await appPool.end();
  });

  it('1. Crea tercero proveedor con RNC de 9 dígitos', async () => {
    const id = newId();
    await runAsApp(appPool, tenantA, userId, async (client) => {
      await client.query(
        `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula,
          nombre_comercial, tipo_contribuyente, condicion_dgii,
          es_proveedor, created_at, created_by, updated_at, updated_by)
         VALUES ($1,$2,'RNC',$3,'Proveedor Demo','PERSONA_JURIDICA','NORMAL',
                 true, now(), $4, now(), $4)`,
        [id, tenantA, RNC_DEMO, userId],
      );
    });

    const [row] = await adminDb
      .select()
      .from(schema.terceros)
      .where(eq(schema.terceros.id, id));

    expect(row).toBeDefined();
    expect(row!.rncCedula).toBe(RNC_DEMO);
    expect(row!.esProveedor).toBe(true);
  });

  it('2. RLS: tenant B no ve terceros del tenant A', async () => {
    const rows = await runAsApp(appPool, tenantB, userId, async (client) => {
      const res = await client.query<{ id: string }>(
        `SELECT id FROM tercero WHERE tenant_id = $1`,
        [tenantA],
      );
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('3. Duplicar RNC en el mismo tenant genera violación 23505', async () => {
    await expect(
      runAsApp(appPool, tenantA, userId, async (client) => {
        await client.query(
          `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula,
            nombre_comercial, tipo_contribuyente, condicion_dgii,
            es_cliente, created_at, created_by, updated_at, updated_by)
           VALUES ($1,$2,'RNC',$3,'Otro Nombre','PERSONA_JURIDICA','NORMAL',
                   true, now(), $4, now(), $4)`,
          [newId(), tenantA, RNC_DEMO, userId],
        );
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('4. Soft-delete: tercero desaparece de lista activa', async () => {
    const id = newId();
    await runAsApp(appPool, tenantA, userId, async (client) => {
      await client.query(
        `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula,
          nombre_comercial, tipo_contribuyente, condicion_dgii,
          es_cliente, created_at, created_by, updated_at, updated_by)
         VALUES ($1,$2,'RNC','123456789','Cliente Borrable','PERSONA_JURIDICA','NORMAL',
                 true, now(), $3, now(), $3)`,
        [id, tenantA, userId],
      );
      await client.query(
        `UPDATE tercero SET deleted_at = now(), deleted_by = $1, activo = false,
          updated_at = now(), updated_by = $1
         WHERE id = $2`,
        [userId, id],
      );
    });

    const rows = await runAsApp(appPool, tenantA, userId, async (client) => {
      const res = await client.query<{ id: string }>(
        `SELECT id FROM tercero WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return res.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it('5. CHECK rol: insertar sin ningún rol activo es rechazado por DB', async () => {
    await expect(
      runAsApp(appPool, tenantA, userId, async (client) => {
        await client.query(
          `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula,
            nombre_comercial, tipo_contribuyente, condicion_dgii,
            created_at, created_by, updated_at, updated_by)
           VALUES ($1,$2,'RNC','999999999','Sin Roles','PERSONA_JURIDICA','NORMAL',
                   now(), $3, now(), $3)`,
          [newId(), tenantA, userId],
        );
      }),
    ).rejects.toMatchObject({ code: '23514' }); // check violation
  });

  it('6. Actualizar email y nombre comercial', async () => {
    // Obtener el primer tercero del tenant A
    const [row] = await adminDb
      .select()
      .from(schema.terceros)
      .where(and(eq(schema.terceros.tenantId, tenantA), isNull(schema.terceros.deletedAt)))
      .limit(1);

    expect(row).toBeDefined();

    await runAsApp(appPool, tenantA, userId, async (client) => {
      await client.query(
        `UPDATE tercero SET email = $1, nombre_comercial = $2,
          updated_at = now(), updated_by = $3
         WHERE id = $4`,
        ['proveedor@ejemplo.com', 'Proveedor Actualizado', userId, row!.id],
      );
    });

    const [updated] = await adminDb
      .select()
      .from(schema.terceros)
      .where(eq(schema.terceros.id, row!.id));

    expect(updated!.email).toBe('proveedor@ejemplo.com');
    expect(updated!.nombreComercial).toBe('Proveedor Actualizado');
  });
});
