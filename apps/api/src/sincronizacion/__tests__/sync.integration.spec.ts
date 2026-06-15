/**
 * PRUEBAS DE INTEGRACIÓN — Sincronización offline-first + Fotos de campo (Sesión 10 Capa 1)
 *
 *  01. Una operación nueva → encolada como PENDIENTE_EJECUCION
 *  02. Misma idempotency_key enviada dos veces → devuelve estado cacheado (no duplica fila)
 *  03. Keys distintas mismo tipo+payload → dos entradas separadas (sin dedup cruzada)
 *  04. Dos consumo_material mismo insumo+partida → ambas PENDIENTE_EJECUCION (additive, sin conflicto)
 *  05. avance_partida mismo partida+fecha: RESIDENTE llega primero, luego ALMACENISTA → ALMACENISTA pierde
 *  06. avance_partida mismo partida+fecha: ALMACENISTA llega primero, luego RESIDENTE → ALMACENISTA anulado
 *  07. avance_partida mismo partida+fecha: RESIDENTE primero, luego OPERARIO → OPERARIO pierde
 *  08. avance_partida mismo partida+fecha: ADMIN vs RESIDENTE → ADMIN gana siempre
 *  09. Dos avance_partida misma partida pero fechas distintas → sin conflicto, ambas PENDIENTE
 *  10. Batch mixto consumo + avance → procesados independientemente
 *  11. Dos conflictos avance en el mismo batch (secuenciales) → segundo pierde frente al primero
 *  12. registrarFoto → estado PENDIENTE_SUBIDA, latitud/longitud guardados
 *  13. registrarFoto misma foto (hash+entidad) → idempotente, devuelve existente
 *  14. confirmarSubida → estado SUBIDA, storageKey seteado
 *  15. listarPendientes → sólo PENDIENTE_SUBIDA
 *  16. obtenerEstado → conteos correctos por estado
 *  17. RLS: obtenerEstado tenant B no ve operaciones de tenant A
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import { SyncService } from '../sync.service.js';
import { FotoCampoService } from '../foto.service.js';
import type { DbService } from '../../database/db.service.js';
import { colaSincronizacion } from '../../db/schema/sincronizacion/cola_sincronizacion.js';
import { fotosCampo } from '../../db/schema/sincronizacion/foto_campo.js';

// ─── Conexiones ───────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDbSvc(db: NodePgDatabase<typeof schema>): DbService {
  return { tx: db } as unknown as DbService;
}

function makeConsumoOp(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: newId(),
    tipoOperacion: 'consumo_material' as const,
    empresaId: '', // filled per test
    payload: {
      insumoId: newId(),
      almacenId: newId(),
      cantidad: '5.0000',
      unidad: 'saco',
      costoUnitario: '500.0000',
      partidaId: newId(),
    },
    ocurridoEn: '2026-01-15T08:00:00Z',
    dispositivoId: 'dispositivo-test-01',
    rolUsuario: 'ALMACENISTA' as const,
    ...overrides,
  };
}

function makeAvanceOp(
  partidaId: string,
  fecha: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    idempotencyKey: newId(),
    tipoOperacion: 'avance_partida' as const,
    empresaId: '', // filled per test
    payload: {
      parteDiarioId: newId(),
      avanceObraId: newId(),
      proyectoId: newId(),
      partidaId,
      cantidadEjecutada: '10.0000',
      unidad: 'm3',
    },
    ocurridoEn: `${fecha}T08:00:00Z`,
    dispositivoId: 'dispositivo-test-01',
    rolUsuario: 'RESIDENTE' as const,
    ...overrides,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Sincronización offline-first + Fotos de campo', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;
  let syncSvc: SyncService;
  let fotoSvc: FotoCampoService;

  let tenantId: string;
  let tenantId2: string;
  let empresaId: string;
  let empresa2Id: string;
  let proyectoId: string;
  let partidaId: string;
  let partida2Id: string;
  let unidadId: string;
  let clienteId: string;

  // IDs de filas creadas en los tests para cleanup
  const colaIds: string[] = [];
  const fotoIds: string[] = [];

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb = drizzle(adminPool, { schema });

    const dbSvc = makeDbSvc(adminDb);
    syncSvc = new SyncService(dbSvc);
    fotoSvc = new FotoCampoService(dbSvc);

    tenantId = newId();
    tenantId2 = newId();
    empresaId = newId();
    empresa2Id = newId();
    proyectoId = newId();
    partidaId = newId();
    partida2Id = newId();
    unidadId = newId();
    clienteId = newId();

    const uid = SYSTEM_USER_ID;
    const now = new Date();

    await adminDb.insert(schema.tenants).values([
      { id: tenantId,  nombre: 'T-Sync1', slug: `sync-t1-${tenantId.slice(-10)}`,  createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
      { id: tenantId2, nombre: 'T-Sync2', slug: `sync-t2-${tenantId2.slice(-10)}`, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);

    await adminDb.insert(schema.empresas).values([
      { id: empresaId,  tenantId,  nombre: 'Empresa Sync 1', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
      { id: empresa2Id, tenantId: tenantId2, nombre: 'Empresa Sync 2', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);

    await adminDb.insert(schema.terceros).values([{
      id: clienteId, tenantId, tipoIdentificacion: 'RNC',
      rncCedula: '130000009', nombreComercial: 'Cliente Sync',
      tipoContribuyente: 'PERSONA_JURIDICA', condicionDgii: 'NORMAL',
      esCliente: true, esProveedor: false,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.proyectos).values([{
      id: proyectoId, tenantId, empresaId, clienteId,
      nombre: 'Proyecto Sync', codigo: 'SYNC01',
      estado: 'EN_EJECUCION', monedaContrato: 'DOP', tipoObra: 'OTRO',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.unidadesMedida).values([{
      id: unidadId, tenantId, codigo: 'M3S', nombre: 'Metro cúbico sync',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.partidas).values([
      {
        id: partidaId, tenantId, proyectoId, nivel: 2, orden: 1,
        numeroJerarquico: '1.1', codigo: 'SYP-001', nombre: 'Partida Sync A',
        unidadMedidaId: unidadId, cantidadPresupuestada: '100.0000', precioUnitario: '5000.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: partida2Id, tenantId, proyectoId, nivel: 2, orden: 2,
        numeroJerarquico: '1.2', codigo: 'SYP-002', nombre: 'Partida Sync B',
        unidadMedidaId: unidadId, cantidadPresupuestada: '50.0000', precioUnitario: '3000.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);
  });

  afterAll(async () => {
    // Cola y fotos de campo
    await adminDb.delete(colaSincronizacion).where(eq(colaSincronizacion.tenantId, tenantId));
    await adminDb.delete(colaSincronizacion).where(eq(colaSincronizacion.tenantId, tenantId2));
    await adminDb.delete(fotosCampo).where(eq(fotosCampo.tenantId, tenantId));

    // Deshabilitar triggers prevent_delete para limpieza de fixtures
    await adminPool.query(`ALTER TABLE partida  DISABLE TRIGGER no_delete_partida`);
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`ALTER TABLE empresa  DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`ALTER TABLE tenant   DISABLE TRIGGER no_delete_tenant`);

    await adminDb.delete(schema.partidas).where(eq(schema.partidas.tenantId, tenantId));
    await adminDb.delete(schema.unidadesMedida).where(eq(schema.unidadesMedida.tenantId, tenantId));
    await adminDb.delete(schema.proyectos).where(eq(schema.proyectos.tenantId, tenantId));
    await adminDb.delete(schema.terceros).where(eq(schema.terceros.tenantId, tenantId));
    await adminDb.delete(schema.empresas).where(eq(schema.empresas.tenantId, tenantId));
    await adminDb.delete(schema.empresas).where(eq(schema.empresas.tenantId, tenantId2));
    // audit_log FK a tenant — borrar antes
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = $1 OR tenant_id = $2`, [tenantId, tenantId2]);
    await adminDb.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await adminDb.delete(schema.tenants).where(eq(schema.tenants.id, tenantId2));

    await adminPool.query(`ALTER TABLE partida  ENABLE TRIGGER no_delete_partida`);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`ALTER TABLE empresa  ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`ALTER TABLE tenant   ENABLE TRIGGER no_delete_tenant`);

    await adminPool.end();
  });

  // ─── 01: operación nueva → PENDIENTE_EJECUCION ──────────────────────────────

  it('01. Una operación nueva → encolada como PENDIENTE_EJECUCION', async () => {
    const op = makeConsumoOp({ empresaId });
    const result = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, {
      operaciones: [op],
    });

    expect(result.totalPendiente).toBe(1);
    expect(result.operaciones[0].estado).toBe('PENDIENTE_EJECUCION');
    expect(result.operaciones[0].colaId).toBeDefined();

    colaIds.push(result.operaciones[0].colaId!);

    // Verificar en DB
    const [fila] = await adminDb
      .select()
      .from(colaSincronizacion)
      .where(eq(colaSincronizacion.idempotencyKey, op.idempotencyKey));
    expect(fila).toBeDefined();
    expect(fila.estado).toBe('PENDIENTE_EJECUCION');
    expect(fila.tipoOperacion).toBe('consumo_material');
  });

  // ─── 02: idempotencia ────────────────────────────────────────────────────────

  it('02. Misma idempotency_key enviada dos veces → devuelve estado cacheado sin duplicar', async () => {
    const op = makeConsumoOp({ empresaId });

    // Primera vez
    const r1 = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [op] });
    expect(r1.operaciones[0].estado).toBe('PENDIENTE_EJECUCION');
    colaIds.push(r1.operaciones[0].colaId!);

    // Segunda vez — misma key
    const r2 = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [op] });
    expect(r2.operaciones[0].estado).toBe('PENDIENTE_EJECUCION');
    expect(r2.operaciones[0].colaId).toBe(r1.operaciones[0].colaId);

    // Solo 1 fila en DB
    const filas = await adminDb
      .select()
      .from(colaSincronizacion)
      .where(
        and(
          eq(colaSincronizacion.tenantId, tenantId),
          eq(colaSincronizacion.idempotencyKey, op.idempotencyKey),
        ),
      );
    expect(filas.length).toBe(1);
  });

  // ─── 03: keys distintas no se dedupen entre sí ───────────────────────────────

  it('03. Keys distintas mismo tipo+payload → dos entradas separadas', async () => {
    const shared = { empresaId, payload: makeConsumoOp({ empresaId }).payload };
    const op1 = makeConsumoOp({ ...shared, idempotencyKey: newId() });
    const op2 = makeConsumoOp({ ...shared, idempotencyKey: newId() });

    const r = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [op1, op2] });
    expect(r.totalPendiente).toBe(2);
    expect(r.operaciones[0].colaId).not.toBe(r.operaciones[1].colaId);

    colaIds.push(r.operaciones[0].colaId!, r.operaciones[1].colaId!);
  });

  // ─── 04: consumo_material es aditivo (sin conflicto) ─────────────────────────

  it('04. Dos consumo_material mismo insumo+partida → ambas PENDIENTE_EJECUCION (additive)', async () => {
    const insumoId = newId();
    const almacenId = newId();
    const payload = {
      insumoId, almacenId, cantidad: '10.0000', unidad: 'kg',
      costoUnitario: '200.0000', partidaId,
    };

    const op1 = makeConsumoOp({ empresaId, payload, ocurridoEn: '2026-01-16T09:00:00Z' });
    const op2 = makeConsumoOp({ empresaId, payload, ocurridoEn: '2026-01-16T10:00:00Z' });

    const r = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [op1, op2] });

    expect(r.totalConflicto).toBe(0);
    expect(r.totalPendiente).toBe(2);
    expect(r.operaciones[0].estado).toBe('PENDIENTE_EJECUCION');
    expect(r.operaciones[1].estado).toBe('PENDIENTE_EJECUCION');

    colaIds.push(r.operaciones[0].colaId!, r.operaciones[1].colaId!);
  });

  // ─── 05: RESIDENTE primero, ALMACENISTA pierde ───────────────────────────────

  it('05. avance mismo partida+fecha: RESIDENTE primero, ALMACENISTA después → ALMACENISTA pierde', async () => {
    const p = newId(); // partida aislada para este test
    const fecha = '2026-02-01';

    const opResidente = makeAvanceOp(p, fecha, { empresaId, rolUsuario: 'RESIDENTE' });
    const r1 = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [opResidente] });
    expect(r1.operaciones[0].estado).toBe('PENDIENTE_EJECUCION');
    colaIds.push(r1.operaciones[0].colaId!);

    const opAlmacenista = makeAvanceOp(p, fecha, { empresaId, rolUsuario: 'ALMACENISTA' });
    const r2 = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [opAlmacenista] });
    expect(r2.operaciones[0].estado).toBe('CONFLICTO');
    expect(r2.operaciones[0].conflictoDetalle).toContain('pierde');
    colaIds.push(r2.operaciones[0].colaId!);
  });

  // ─── 06: ALMACENISTA primero, RESIDENTE anula al ALMACENISTA ─────────────────

  it('06. avance mismo partida+fecha: ALMACENISTA primero, RESIDENTE después → ALMACENISTA anulado', async () => {
    const p = newId();
    const fecha = '2026-02-02';

    const opAlmacenista = makeAvanceOp(p, fecha, { empresaId, rolUsuario: 'ALMACENISTA' });
    const r1 = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [opAlmacenista] });
    expect(r1.operaciones[0].estado).toBe('PENDIENTE_EJECUCION');
    const almacenistaColaId = r1.operaciones[0].colaId!;
    colaIds.push(almacenistaColaId);

    const opResidente = makeAvanceOp(p, fecha, { empresaId, rolUsuario: 'RESIDENTE' });
    const r2 = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [opResidente] });
    expect(r2.operaciones[0].estado).toBe('PENDIENTE_EJECUCION');
    expect(r2.operaciones[0].conflictoDetalle).toContain('Conflicto resuelto');
    colaIds.push(r2.operaciones[0].colaId!);

    // La entrada del ALMACENISTA debe estar ANULADO_POR_CONFLICTO
    const [rivalFila] = await adminDb
      .select({ estado: colaSincronizacion.estado })
      .from(colaSincronizacion)
      .where(eq(colaSincronizacion.id, almacenistaColaId));
    expect(rivalFila.estado).toBe('ANULADO_POR_CONFLICTO');
  });

  // ─── 07: RESIDENTE primero, OPERARIO pierde ──────────────────────────────────

  it('07. avance mismo partida+fecha: RESIDENTE primero, OPERARIO después → OPERARIO pierde', async () => {
    const p = newId();
    const fecha = '2026-02-03';

    const opRes = makeAvanceOp(p, fecha, { empresaId, rolUsuario: 'RESIDENTE' });
    const r1 = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [opRes] });
    colaIds.push(r1.operaciones[0].colaId!);

    const opOp = makeAvanceOp(p, fecha, { empresaId, rolUsuario: 'OPERARIO' });
    const r2 = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [opOp] });
    expect(r2.operaciones[0].estado).toBe('CONFLICTO');
    colaIds.push(r2.operaciones[0].colaId!);
  });

  // ─── 08: ADMIN gana siempre ───────────────────────────────────────────────────

  it('08. avance mismo partida+fecha: RESIDENTE primero, ADMIN después → ADMIN gana', async () => {
    const p = newId();
    const fecha = '2026-02-04';

    const opRes = makeAvanceOp(p, fecha, { empresaId, rolUsuario: 'RESIDENTE' });
    const r1 = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [opRes] });
    const resColaId = r1.operaciones[0].colaId!;
    colaIds.push(resColaId);

    const opAdmin = makeAvanceOp(p, fecha, { empresaId, rolUsuario: 'ADMIN' });
    const r2 = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [opAdmin] });
    expect(r2.operaciones[0].estado).toBe('PENDIENTE_EJECUCION');
    colaIds.push(r2.operaciones[0].colaId!);

    const [rival] = await adminDb
      .select({ estado: colaSincronizacion.estado })
      .from(colaSincronizacion)
      .where(eq(colaSincronizacion.id, resColaId));
    expect(rival.estado).toBe('ANULADO_POR_CONFLICTO');
  });

  // ─── 09: misma partida, fechas distintas → sin conflicto ─────────────────────

  it('09. Dos avances misma partida pero fechas distintas → sin conflicto, ambas PENDIENTE', async () => {
    const p = newId();

    const op1 = makeAvanceOp(p, '2026-02-10', { empresaId });
    const op2 = makeAvanceOp(p, '2026-02-11', { empresaId });

    const r = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [op1, op2] });
    expect(r.totalConflicto).toBe(0);
    expect(r.totalPendiente).toBe(2);
    colaIds.push(r.operaciones[0].colaId!, r.operaciones[1].colaId!);
  });

  // ─── 10: batch mixto consumo + avance ────────────────────────────────────────

  it('10. Batch mixto: consumo_material + avance_partida → procesados independientemente', async () => {
    const opConsumo = makeConsumoOp({ empresaId });
    const opAvance = makeAvanceOp(newId(), '2026-02-15', { empresaId });

    const r = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, {
      operaciones: [opConsumo, opAvance],
    });

    expect(r.totalPendiente).toBe(2);
    expect(r.totalConflicto).toBe(0);
    expect(r.operaciones[0].estado).toBe('PENDIENTE_EJECUCION');
    expect(r.operaciones[1].estado).toBe('PENDIENTE_EJECUCION');
    colaIds.push(r.operaciones[0].colaId!, r.operaciones[1].colaId!);
  });

  // ─── 11: dos conflictos en el mismo batch (secuenciales) ─────────────────────

  it('11. Dos avances mismo partida+fecha en el mismo batch → segundo pierde frente al primero', async () => {
    const p = newId();
    const fecha = '2026-02-20';

    const op1 = makeAvanceOp(p, fecha, { empresaId, rolUsuario: 'RESIDENTE' });
    const op2 = makeAvanceOp(p, fecha, { empresaId, rolUsuario: 'ALMACENISTA' });

    const r = await syncSvc.procesarBatch(tenantId, SYSTEM_USER_ID, { operaciones: [op1, op2] });
    expect(r.operaciones[0].estado).toBe('PENDIENTE_EJECUCION');
    expect(r.operaciones[1].estado).toBe('CONFLICTO');

    colaIds.push(r.operaciones[0].colaId!, r.operaciones[1].colaId!);
  });

  // ─── 12: registrarFoto con geolocalización ────────────────────────────────────

  it('12. registrarFoto → estado PENDIENTE_SUBIDA, latitud/longitud guardados', async () => {
    const entidadId = newId();
    const foto = await fotoSvc.registrarFoto(tenantId, SYSTEM_USER_ID, {
      empresaId,
      entidadTipo: 'parte_diario',
      entidadId,
      latitud: 18.4861,
      longitud: -69.9312,
      precisionMetros: 5.0,
      timestampCaptura: '2026-02-01T10:30:00Z',
      hashLocal: 'sha256-abc123def456',
      bytes: 204800,
      mimeType: 'image/jpeg',
    });

    expect(foto.estado).toBe('PENDIENTE_SUBIDA');
    expect(foto.latitud).toBe('18.4861000');
    expect(foto.longitud).toBe('-69.9312000');
    expect(foto.hashLocal).toBe('sha256-abc123def456');
    expect(foto.storageKey).toBeNull();
    fotoIds.push(foto.id);
  });

  // ─── 13: registrarFoto idempotente por hash+entidad ──────────────────────────

  it('13. registrarFoto misma foto (hash+entidad) → idempotente, devuelve existente', async () => {
    const entidadId = newId();
    const dto = {
      empresaId,
      entidadTipo: 'parte_diario' as const,
      entidadId,
      timestampCaptura: '2026-02-02T11:00:00Z',
      hashLocal: 'sha256-dedup-test',
    };

    const foto1 = await fotoSvc.registrarFoto(tenantId, SYSTEM_USER_ID, dto);
    const foto2 = await fotoSvc.registrarFoto(tenantId, SYSTEM_USER_ID, dto);

    expect(foto1.id).toBe(foto2.id);
    fotoIds.push(foto1.id);
  });

  // ─── 14: confirmarSubida → estado SUBIDA ──────────────────────────────────────

  it('14. confirmarSubida → estado SUBIDA, storageKey seteado', async () => {
    const entidadId = newId();
    const foto = await fotoSvc.registrarFoto(tenantId, SYSTEM_USER_ID, {
      empresaId,
      entidadTipo: 'avance_obra',
      entidadId,
      timestampCaptura: '2026-02-03T09:00:00Z',
      hashLocal: `sha256-confirm-${newId().slice(0, 8)}`,
    });
    fotoIds.push(foto.id);

    const actualizada = await fotoSvc.confirmarSubida(
      tenantId,
      foto.id,
      `obras/sync/${foto.id}.jpg`,
      SYSTEM_USER_ID,
    );

    expect(actualizada.estado).toBe('SUBIDA');
    expect(actualizada.storageKey).toBe(`obras/sync/${foto.id}.jpg`);
  });

  // ─── 15: listarPendientes → solo PENDIENTE_SUBIDA ────────────────────────────

  it('15. listarPendientes → devuelve solo fotos en estado PENDIENTE_SUBIDA', async () => {
    // Crear una pendiente y una subida para el mismo tenant
    const pend = await fotoSvc.registrarFoto(tenantId, SYSTEM_USER_ID, {
      empresaId,
      entidadTipo: 'parte_diario',
      entidadId: newId(),
      timestampCaptura: '2026-02-04T08:00:00Z',
      hashLocal: `sha256-pend-${newId().slice(0, 8)}`,
    });
    fotoIds.push(pend.id);

    const subida = await fotoSvc.registrarFoto(tenantId, SYSTEM_USER_ID, {
      empresaId,
      entidadTipo: 'parte_diario',
      entidadId: newId(),
      timestampCaptura: '2026-02-04T09:00:00Z',
      hashLocal: `sha256-sub-${newId().slice(0, 8)}`,
    });
    fotoIds.push(subida.id);
    await fotoSvc.confirmarSubida(tenantId, subida.id, 'key/subida.jpg', SYSTEM_USER_ID);

    const pendientes = await fotoSvc.listarPendientes(tenantId);
    const ids = pendientes.map((f) => f.id);
    expect(ids).toContain(pend.id);
    expect(ids).not.toContain(subida.id);
    pendientes.forEach((f) => expect(f.estado).toBe('PENDIENTE_SUBIDA'));
  });

  // ─── 16: obtenerEstado → conteos correctos ────────────────────────────────────

  it('16. obtenerEstado → conteos correctos por estado', async () => {
    const estado = await syncSvc.obtenerEstado(tenantId);

    // Deben existir al menos las ops de los tests anteriores
    expect(estado.pendienteEjecucion).toBeGreaterThan(0);
    expect(estado.conflicto).toBeGreaterThan(0); // tests 05, 07, 11
    expect(estado.anuladoPorConflicto).toBeGreaterThan(0); // tests 06, 08

    // Los conteos son enteros positivos
    expect(Number.isInteger(estado.pendienteEjecucion)).toBe(true);
    expect(Number.isInteger(estado.conflicto)).toBe(true);
  });

  // ─── 17: RLS — tenant B no ve operaciones de tenant A ─────────────────────────

  it('17. RLS: obtenerEstado tenant B no ve operaciones de tenant A', async () => {
    // Tenant A ya tiene operaciones de tests anteriores
    const estadoA = await syncSvc.obtenerEstado(tenantId);
    expect(estadoA.pendienteEjecucion + estadoA.conflicto).toBeGreaterThan(0);

    // Tenant B está limpio
    const estadoB = await syncSvc.obtenerEstado(tenantId2);
    expect(estadoB.pendienteEjecucion).toBe(0);
    expect(estadoB.conflicto).toBe(0);
    expect(estadoB.procesado).toBe(0);
  });
});
