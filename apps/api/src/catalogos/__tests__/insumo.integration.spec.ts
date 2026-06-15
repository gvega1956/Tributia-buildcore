/**
 * PRUEBAS DE INTEGRACIÓN — Insumos y Unidades de medida (Catálogos maestros)
 *
 *   1. Crear unidad de medida 'KG'.
 *   2. Código de unidad único por tenant: duplicado rechazado.
 *   3. Crear insumo referenciando la unidad creada.
 *   4. Código de insumo único por tenant: duplicado rechazado.
 *   5. Añadir equivalencia insumo: 1 SC = 42.5 KG.
 *   6. Equivalencia duplicada (mismo insumo+origen+destino) rechazada.
 *   7. RLS: tenant B no ve insumos del tenant A.
 *
 * Requiere: `docker compose up -d postgres` + migraciones 0000–0006 aplicadas.
 * Correr: pnpm --filter @tributia/api test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
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

describe('Insumos y unidades de medida — integración (P4.4 + RLS)', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  let tenantA: string;
  let tenantB: string;
  const userId = newId();
  let unidadKgId: string;
  let unidadScId: string;
  let insumoId: string;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool   = new Pool({ connectionString: APP_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantA = newId();
    tenantB = newId();

    await adminDb.insert(schema.tenants).values([
      { id: tenantA, nombre: 'Tenant A [insumo-test]', slug: `insumo-a-${tenantA.slice(0, 6)}`, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
      { id: tenantB, nombre: 'Tenant B [insumo-test]', slug: `insumo-b-${tenantB.slice(0, 6)}`, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
    ]);
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM insumo_equivalencia WHERE tenant_id IN ($1,$2)`, [tenantA, tenantB]);
    await adminPool.query(`DELETE FROM insumo WHERE tenant_id IN ($1,$2)`, [tenantA, tenantB]);
    await adminPool.query(`DELETE FROM unidad_medida WHERE tenant_id IN ($1,$2)`, [tenantA, tenantB]);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id IN ($1,$2)`, [tenantA, tenantB]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id IN ($1,$2)`, [tenantA, tenantB]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
    await appPool.end();
  });

  it('1. Crear unidad de medida KG', async () => {
    unidadKgId = newId();
    await runAsApp(appPool, tenantA, userId, async (client) => {
      await client.query(
        `INSERT INTO unidad_medida (id, tenant_id, codigo, nombre,
          created_at, created_by, updated_at, updated_by)
         VALUES ($1,$2,'KG','Kilogramo',now(),$3,now(),$3)`,
        [unidadKgId, tenantA, userId],
      );
    });

    const [row] = await adminDb
      .select()
      .from(schema.unidadesMedida)
      .where(eq(schema.unidadesMedida.id, unidadKgId));

    expect(row).toBeDefined();
    expect(row!.codigo).toBe('KG');
  });

  it('2. Duplicar código de unidad en el mismo tenant es rechazado', async () => {
    await expect(
      runAsApp(appPool, tenantA, userId, async (client) => {
        await client.query(
          `INSERT INTO unidad_medida (id, tenant_id, codigo, nombre,
            created_at, created_by, updated_at, updated_by)
           VALUES ($1,$2,'KG','Kilogramo duplicado',now(),$3,now(),$3)`,
          [newId(), tenantA, userId],
        );
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('3. Crear insumo cemento referenciando la unidad KG', async () => {
    insumoId = newId();
    await runAsApp(appPool, tenantA, userId, async (client) => {
      await client.query(
        `INSERT INTO insumo (id, tenant_id, codigo, nombre, unidad_id, categoria,
          created_at, created_by, updated_at, updated_by)
         VALUES ($1,$2,'CEM-P30','Cemento Portland Tipo I',$3,'MATERIAL',
                 now(),$4,now(),$4)`,
        [insumoId, tenantA, unidadKgId, userId],
      );
    });

    const [row] = await adminDb
      .select()
      .from(schema.insumos)
      .where(eq(schema.insumos.id, insumoId));

    expect(row).toBeDefined();
    expect(row!.codigo).toBe('CEM-P30');
    expect(row!.unidadId).toBe(unidadKgId);
  });

  it('4. Duplicar código de insumo en el mismo tenant es rechazado', async () => {
    await expect(
      runAsApp(appPool, tenantA, userId, async (client) => {
        await client.query(
          `INSERT INTO insumo (id, tenant_id, codigo, nombre, unidad_id, categoria,
            created_at, created_by, updated_at, updated_by)
           VALUES ($1,$2,'CEM-P30','Cemento duplicado',$3,'MATERIAL',
                   now(),$4,now(),$4)`,
          [newId(), tenantA, unidadKgId, userId],
        );
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('5. Añadir equivalencia: 1 SC = 42.5 KG', async () => {
    unidadScId = newId();
    await runAsApp(appPool, tenantA, userId, async (client) => {
      await client.query(
        `INSERT INTO unidad_medida (id, tenant_id, codigo, nombre,
          created_at, created_by, updated_at, updated_by)
         VALUES ($1,$2,'SC','Saco',now(),$3,now(),$3)`,
        [unidadScId, tenantA, userId],
      );
    });

    const equivId = newId();
    await runAsApp(appPool, tenantA, userId, async (client) => {
      await client.query(
        `INSERT INTO insumo_equivalencia (id, tenant_id, insumo_id,
          unidad_origen_id, factor, unidad_destino_id,
          created_at, created_by, updated_at, updated_by)
         VALUES ($1,$2,$3,$4,'42.500000',$5,now(),$6,now(),$6)`,
        [equivId, tenantA, insumoId, unidadScId, unidadKgId, userId],
      );
    });

    const [row] = await adminDb
      .select()
      .from(schema.insumosEquivalencia)
      .where(eq(schema.insumosEquivalencia.id, equivId));

    expect(row).toBeDefined();
    expect(parseFloat(row!.factor)).toBeCloseTo(42.5);
  });

  it('6. Equivalencia duplicada (mismo insumo+origen+destino) es rechazada', async () => {
    await expect(
      runAsApp(appPool, tenantA, userId, async (client) => {
        await client.query(
          `INSERT INTO insumo_equivalencia (id, tenant_id, insumo_id,
            unidad_origen_id, factor, unidad_destino_id,
            created_at, created_by, updated_at, updated_by)
           VALUES ($1,$2,$3,$4,'42.500000',$5,now(),$6,now(),$6)`,
          [newId(), tenantA, insumoId, unidadScId, unidadKgId, userId],
        );
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('7. RLS: tenant B no ve insumos del tenant A', async () => {
    // Insertar una unidad en B para que no falle por tenant inexistente
    await runAsApp(appPool, tenantB, userId, async (client) => {
      // Solo verificamos que la query filtra correctamente
      const res = await client.query<{ id: string }>(
        `SELECT id FROM insumo WHERE tenant_id = $1`,
        [tenantA],
      );
      expect(res.rows).toHaveLength(0);
    });
  });
});
