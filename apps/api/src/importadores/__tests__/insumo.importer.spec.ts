/**
 * PRUEBAS DE INTEGRACIÓN — Importador de Insumos (Sesión 11 Capa 0)
 *
 *   1. Importar 3 filas válidas en modo simulación: 3 procesadas, 0 errores, no inserta en BD.
 *   2. Importar 2 válidas + 1 con código vacío: 2 procesadas, 1 error de validación.
 *   3. Importar con unidad inexistente: error de procesamiento informado correctamente.
 *   4. Importar en modo real (simulacion=false): insumos insertados en BD.
 *   5. Importar con duplicado de código: error de conflicto registrado, resto procesado.
 *   6. generarReporteCSV produce líneas correctas con errores.
 *
 * Requieren Docker corriendo: `docker compose up -d postgres`
 * Requieren las migraciones aplicadas hasta 0008.
 * Correr con: pnpm --filter @tributia/api test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import type { DbService } from '../../database/db.service.js';
import { InsumoService } from '../../catalogos/insumo.service.js';
import { InsumoImporter } from '../insumo.importer.js';

// ─── Conexión ─────────────────────────────────────────────────────────────────

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDbService(adminDb: NodePgDatabase<typeof schema>): DbService {
  return {
    get tx() { return adminDb; },
    get adminDb() { return adminDb; },
  } as unknown as DbService;
}

async function buildExcelBuffer(
  filas: (string | null)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Insumos');
  sheet.addRow(['codigo', 'nombre', 'descripcion', 'unidad', 'categoria', 'codigo_dgii']);
  for (const fila of filas) {
    sheet.addRow(fila);
  }
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('InsumoImporter — integración', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;
  let importer: InsumoImporter;
  let insumoService: InsumoService;

  let tenantId: string;
  let unidadKgId: string;
  let unidadScId: string;
  const usuarioId = SYSTEM_USER_ID;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb = drizzle(adminPool, { schema });

    tenantId = newId();
    await adminDb.insert(schema.tenants).values({
      id: tenantId,
      nombre: 'Tenant Importador [test]',
      slug: `test-imp-${tenantId.slice(0, 8)}`,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    const db = makeDbService(adminDb);
    insumoService = new InsumoService(db);
    importer = new InsumoImporter(db, insumoService);

    // Crear unidades de medida para pruebas
    const now = new Date();
    const [kg] = await adminDb.insert(schema.unidadesMedida).values({
      id: newId(),
      tenantId,
      codigo: 'KG',
      nombre: 'Kilogramo',
      createdAt: now, createdBy: SYSTEM_USER_ID,
      updatedAt: now, updatedBy: SYSTEM_USER_ID,
    }).returning();
    unidadKgId = kg!.id;

    const [sc] = await adminDb.insert(schema.unidadesMedida).values({
      id: newId(),
      tenantId,
      codigo: 'SC',
      nombre: 'Saco',
      createdAt: now, createdBy: SYSTEM_USER_ID,
      updatedAt: now, updatedBy: SYSTEM_USER_ID,
    }).returning();
    unidadScId = sc!.id;

    // Suprimir advertencia "unidadScId not used" — usada indirectamente via seed
    void unidadKgId;
    void unidadScId;
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM insumo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM unidad_medida WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
  });

  // ─── 1. Simulación: 3 filas válidas ───────────────────────────────────────

  it('1. simulacion=true: 3 filas válidas → procesadas=3, errores=[], no inserta en BD', async () => {
    const buffer = await buildExcelBuffer([
      ['CEM-SIM', 'Cemento Portland Tipo I', 'Saco 42.5 kg', 'SC', 'MATERIAL', null],
      ['VAR-SIM', 'Varilla 3/8"', null, 'KG', 'MATERIAL', null],
      ['BLK-SIM', 'Block 6x8x16', null, 'UN', 'MATERIAL', null],
    ]);

    const result = await importer.importar(
      buffer,
      { tenantId, usuarioId },
      true, // simulacion
    );

    expect(result.simulacion).toBe(true);
    expect(result.totalFilas).toBe(3);
    // BLK-SIM tiene unidad UN que no existe → error de validación no, es procesarFila
    // En simulacion=true, solo validarFila → BLK-SIM podría ser válido en validación
    // (unidad se valida en procesarFila, no en validarFila)
    expect(result.errores).toHaveLength(0);
    expect(result.procesadas).toBe(3);

    // No debe haber insertado nada
    const insumos = await adminDb
      .select()
      .from(schema.insumos)
      .where(and(eq(schema.insumos.tenantId, tenantId), eq(schema.insumos.codigo, 'CEM-SIM')));
    expect(insumos).toHaveLength(0);
  });

  // ─── 2. Fila con campo requerido vacío ────────────────────────────────────

  it('2. fila con codigo vacío → 1 error de validación, otras 2 procesadas', async () => {
    const buffer = await buildExcelBuffer([
      ['CEM-A1', 'Cemento Portland', null, 'SC', 'MATERIAL', null],
      [null,     'Sin codigo',       null, 'SC', 'MATERIAL', null], // fila inválida
      ['VAR-A1', 'Varilla 3/8"',     null, 'KG', 'MATERIAL', null],
    ]);

    const result = await importer.importar(buffer, { tenantId, usuarioId }, true);

    expect(result.totalFilas).toBe(3);
    expect(result.errores).toHaveLength(1);
    expect(result.errores[0]!.fila).toBe(3); // fila 3 (header=1, primera data=2)
    expect(result.errores[0]!.campo).toBe('codigo');
  });

  // ─── 3. Unidad inexistente en modo real ───────────────────────────────────

  it('3. importar real con unidad inexistente → error en procesarFila', async () => {
    const buffer = await buildExcelBuffer([
      ['INS-UNK', 'Insumo con unidad rara', null, 'RARA', 'MATERIAL', null],
    ]);

    const result = await importer.importar(buffer, { tenantId, usuarioId }, false);

    expect(result.errores).toHaveLength(1);
    expect(result.errores[0]!.error).toMatch(/unidad.*no existe/i);
    expect(result.procesadas).toBe(0);
  });

  // ─── 4. Importación real exitosa ─────────────────────────────────────────

  it('4. importar real 2 insumos válidos → insertados en BD', async () => {
    const buffer = await buildExcelBuffer([
      ['CEM-REAL', 'Cemento Portland I',   'Saco 42.5 kg', 'SC', 'MATERIAL',    null],
      ['VAR-REAL', 'Varilla corrugada 3/8"', null,          'KG', 'MATERIAL', null],
    ]);

    const result = await importer.importar(buffer, { tenantId, usuarioId }, false);

    expect(result.simulacion).toBe(false);
    expect(result.procesadas).toBe(2);
    expect(result.errores).toHaveLength(0);

    const [cem] = await adminDb
      .select()
      .from(schema.insumos)
      .where(and(eq(schema.insumos.tenantId, tenantId), eq(schema.insumos.codigo, 'CEM-REAL')));

    expect(cem).toBeDefined();
    expect(cem!.nombre).toBe('Cemento Portland I');
    expect(cem!.unidadId).toBe(unidadScId);
  });

  // ─── 5. Código duplicado ──────────────────────────────────────────────────

  it('5. código duplicado → error registrado, otro insumo procesado', async () => {
    const buffer = await buildExcelBuffer([
      ['CEM-REAL', 'Cemento repetido',    null, 'SC', 'MATERIAL', null], // ya existe
      ['BLK-REAL', 'Block hueco 6x8x16', null, 'SC', 'MATERIAL', null],
    ]);

    const result = await importer.importar(buffer, { tenantId, usuarioId }, false);

    expect(result.errores).toHaveLength(1);
    expect(result.errores[0]!.error).toMatch(/código.*'CEM-REAL'/i);
    expect(result.procesadas).toBe(1);
  });

  // ─── 6. generarReporteCSV ─────────────────────────────────────────────────

  it('6. generarReporteCSV produce CSV con cabecera y líneas de error correctas', () => {
    const errores = [
      { fila: 3, campo: 'codigo', error: 'Required', valorRecibido: null },
      { fila: 5, campo: 'unidad', error: "Unidad 'X' no existe", valorRecibido: 'X' },
    ];
    const csv = importer.generarReporteCSV({
      totalFilas: 5, procesadas: 3, omitidas: 2, errores, simulacion: false,
    });

    const lineas = csv.split('\n');
    expect(lineas[0]).toBe('Fila,Campo,Error,ValorRecibido');
    expect(lineas[1]).toContain('"3"');
    expect(lineas[1]).toContain('"codigo"');
    expect(lineas[2]).toContain('"X"');
  });
});
