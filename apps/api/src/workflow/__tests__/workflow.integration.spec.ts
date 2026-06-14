/**
 * PRUEBAS DE INTEGRACIÓN — Motor de flujos de aprobación (Sesión 9 Capa 0)
 *
 * Verifican cada transición de estado del motor de workflow:
 *
 *   1. Flujo de un paso: aprobar → instancia APROBADO.
 *   2. Flujo de un paso: rechazar → instancia RECHAZADO.
 *   3. Flujo secuencial (2 pasos): aprobar paso 1 → paso 2 PENDIENTE, aprobar paso 2 → APROBADO.
 *   4. Flujo paralelo (2 aprobadores en mismo orden): uno aprueba → EN_PROGRESO; ambos → APROBADO.
 *   5. Delegación: usuario A delega a B; B aprueba → instancia APROBADO.
 *   6. Cancelar flujo EN_PROGRESO → instancia CANCELADO, aprobaciones RECHAZADO.
 *   7. Rechazo en flujo multi-paso cancela todas las aprobaciones pendientes restantes.
 *
 * Requieren Docker corriendo: `docker compose up -d postgres`
 * Requieren las ocho migraciones aplicadas: 0000_tenancy → 0007_workflow.
 * Correr con: pnpm --filter @tributia/api test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import type { DbService } from '../../database/db.service.js';
import { TipoFlujoService } from '../tipo-flujo.service.js';
import { WorkflowService } from '../workflow.service.js';

// ─── Conexiones ──────────────────────────────────────────────────────────────

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Crea un DbService mock que apunta al pool admin (bypassa RLS — apropiado para tests de lógica). */
function makeDbService(adminDb: NodePgDatabase<typeof schema>): DbService {
  return {
    get tx() { return adminDb; },
    get adminDb() { return adminDb; },
  } as unknown as DbService;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Motor de flujos de aprobación — transiciones de estado', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;
  let tipoFlujoService: TipoFlujoService;
  let workflowService: WorkflowService;

  // IDs de fixtures compartidas
  let tenantId: string;
  const userA = newId();
  const userB = newId();

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb   = drizzle(adminPool, { schema });

    // Crear tenant de prueba
    tenantId = newId();
    await adminDb.insert(schema.tenants).values({
      id: tenantId,
      nombre: 'Constructora Workflow [test]',
      slug: `test-wf-${tenantId.slice(0, 8)}`,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // Crear servicios con adminDb
    const db = makeDbService(adminDb);
    tipoFlujoService = new TipoFlujoService(db);
    workflowService  = new WorkflowService(db, tipoFlujoService);
  });

  afterAll(async () => {
    // Eliminar en orden inverso a FK
    await adminPool.query(`DELETE FROM aprobacion_paso WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM instancia_flujo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM paso_flujo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM tipo_flujo WHERE tenant_id = $1`, [tenantId]);
    await adminDb.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await adminPool.end();
  });

  // ─── 1. Flujo un paso: aprobar → APROBADO ────────────────────────────────

  it('1. Flujo de un paso: aprobar → instancia APROBADO', async () => {
    const tipo = await tipoFlujoService.crearTipoFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_1paso_aprobar',
      nombre: 'Test 1 Paso Aprobar',
      descripcion: null,
      condicionMontoMin: null,
      condicionMontoMax: null,
      monedaCondicion: null,
    });

    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 1,
      nombre: 'Aprobador único',
      tipoAprobador: 'USUARIO',
      aprobadorId: userA,
      permiteDelegacion: true,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    const instancia = await workflowService.iniciarFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_1paso_aprobar',
      documentoId: newId(),
      documentoTabla: 'orden_compra',
      monto: null,
      moneda: null,
      descripcion: 'OC de prueba',
      metadata: null,
    });

    expect(instancia.estado).toBe('EN_PROGRESO');
    expect(instancia.pasoActual).toBe(1);

    // Obtener la aprobación pendiente
    const [aprobacion] = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(and(
        eq(schema.aprobacionesPaso.instanciaId, instancia.id),
        eq(schema.aprobacionesPaso.estado, 'PENDIENTE'),
      ));

    expect(aprobacion).toBeDefined();
    expect(aprobacion!.aprobadorId).toBe(userA);

    // Aprobar
    await workflowService.aprobar(aprobacion!.id, userA, { comentario: 'Luce bien' });

    // Verificar instancia APROBADO
    const final = await workflowService.findInstanciaById(instancia.id);
    expect(final.estado).toBe('APROBADO');
    expect(final.finalizadoEn).not.toBeNull();
  });

  // ─── 2. Flujo un paso: rechazar → RECHAZADO ──────────────────────────────

  it('2. Flujo de un paso: rechazar → instancia RECHAZADO', async () => {
    const tipo = await tipoFlujoService.crearTipoFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_1paso_rechazar',
      nombre: 'Test 1 Paso Rechazar',
      descripcion: null,
      condicionMontoMin: null,
      condicionMontoMax: null,
      monedaCondicion: null,
    });

    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 1,
      nombre: 'Aprobador único',
      tipoAprobador: 'USUARIO',
      aprobadorId: userA,
      permiteDelegacion: true,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    const instancia = await workflowService.iniciarFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_1paso_rechazar',
      documentoId: newId(),
      documentoTabla: 'orden_compra',
      monto: null,
      moneda: null,
      descripcion: 'OC rechazada',
      metadata: null,
    });

    const [aprobacion] = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(eq(schema.aprobacionesPaso.instanciaId, instancia.id));

    await workflowService.rechazar(aprobacion!.id, userA, { comentario: 'Precios incorrectos' });

    const final = await workflowService.findInstanciaById(instancia.id);
    expect(final.estado).toBe('RECHAZADO');
    expect(final.finalizadoEn).not.toBeNull();
  });

  // ─── 3. Flujo secuencial 2 pasos: aprobar ambos → APROBADO ───────────────

  it('3. Flujo secuencial (2 pasos): aprobar paso 1 → EN_PROGRESO en paso 2; aprobar paso 2 → APROBADO', async () => {
    const tipo = await tipoFlujoService.crearTipoFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_2pasos',
      nombre: 'Test 2 Pasos Secuenciales',
      descripcion: null,
      condicionMontoMin: null,
      condicionMontoMax: null,
      monedaCondicion: null,
    });

    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 1,
      nombre: 'Primer aprobador',
      tipoAprobador: 'USUARIO',
      aprobadorId: userA,
      permiteDelegacion: true,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 2,
      nombre: 'Segundo aprobador',
      tipoAprobador: 'USUARIO',
      aprobadorId: userB,
      permiteDelegacion: true,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    const instancia = await workflowService.iniciarFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_2pasos',
      documentoId: newId(),
      documentoTabla: 'orden_compra',
      monto: null,
      moneda: null,
      descripcion: 'OC 2 pasos',
      metadata: null,
    });

    expect(instancia.pasoActual).toBe(1);

    // Solo el paso 1 tiene aprobación pendiente
    const aprobacionesPrimerOrden = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(and(
        eq(schema.aprobacionesPaso.instanciaId, instancia.id),
        eq(schema.aprobacionesPaso.ordenPaso, 1),
      ));
    expect(aprobacionesPrimerOrden).toHaveLength(1);
    expect(aprobacionesPrimerOrden[0]!.aprobadorId).toBe(userA);

    // Paso 2 aún no tiene aprobaciones creadas
    const aprobacionesSegundoOrden = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(and(
        eq(schema.aprobacionesPaso.instanciaId, instancia.id),
        eq(schema.aprobacionesPaso.ordenPaso, 2),
      ));
    expect(aprobacionesSegundoOrden).toHaveLength(0);

    // Aprobar paso 1
    await workflowService.aprobar(aprobacionesPrimerOrden[0]!.id, userA, { comentario: null });

    // Instancia debe estar EN_PROGRESO y en paso 2
    const despuesDe1 = await workflowService.findInstanciaById(instancia.id);
    expect(despuesDe1.estado).toBe('EN_PROGRESO');
    expect(despuesDe1.pasoActual).toBe(2);

    // Ahora el paso 2 tiene aprobación pendiente para userB
    const [aprobacion2] = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(and(
        eq(schema.aprobacionesPaso.instanciaId, instancia.id),
        eq(schema.aprobacionesPaso.ordenPaso, 2),
        eq(schema.aprobacionesPaso.estado, 'PENDIENTE'),
      ));
    expect(aprobacion2).toBeDefined();
    expect(aprobacion2!.aprobadorId).toBe(userB);

    // Aprobar paso 2
    await workflowService.aprobar(aprobacion2!.id, userB, { comentario: null });

    const final = await workflowService.findInstanciaById(instancia.id);
    expect(final.estado).toBe('APROBADO');
  });

  // ─── 4. Pasos paralelos (mismo orden): ambos deben aprobar ───────────────

  it('4. Pasos paralelos (mismo orden): primer voto → EN_PROGRESO; segundo voto → APROBADO', async () => {
    const tipo = await tipoFlujoService.crearTipoFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_paralelo',
      nombre: 'Test Pasos Paralelos',
      descripcion: null,
      condicionMontoMin: null,
      condicionMontoMax: null,
      monedaCondicion: null,
    });

    // Dos aprobadores en el MISMO orden = paralelo
    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 1,
      nombre: 'Aprobador A (paralelo)',
      tipoAprobador: 'USUARIO',
      aprobadorId: userA,
      permiteDelegacion: false,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 1,
      nombre: 'Aprobador B (paralelo)',
      tipoAprobador: 'USUARIO',
      aprobadorId: userB,
      permiteDelegacion: false,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    const instancia = await workflowService.iniciarFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_paralelo',
      documentoId: newId(),
      documentoTabla: 'contrato',
      monto: null,
      moneda: null,
      descripcion: 'Contrato paralelo',
      metadata: null,
    });

    // Deben existir 2 aprobaciones pendientes en orden 1
    const pendientes = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(and(
        eq(schema.aprobacionesPaso.instanciaId, instancia.id),
        eq(schema.aprobacionesPaso.estado, 'PENDIENTE'),
      ));
    expect(pendientes).toHaveLength(2);

    const aprobA = pendientes.find((a) => a.aprobadorId === userA)!;
    const aprobB = pendientes.find((a) => a.aprobadorId === userB)!;

    // Primer voto: instancia sigue EN_PROGRESO
    await workflowService.aprobar(aprobA.id, userA, { comentario: null });
    const despuesPrimeroVoto = await workflowService.findInstanciaById(instancia.id);
    expect(despuesPrimeroVoto.estado).toBe('EN_PROGRESO');

    // Segundo voto: todos aprobaron → instancia APROBADO
    await workflowService.aprobar(aprobB.id, userB, { comentario: null });
    const final = await workflowService.findInstanciaById(instancia.id);
    expect(final.estado).toBe('APROBADO');
  });

  // ─── 5. Delegación: A delega a B → B aprueba → APROBADO ─────────────────

  it('5. Delegación: A delega a B; B aprueba → instancia APROBADO', async () => {
    const tipo = await tipoFlujoService.crearTipoFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_delegacion',
      nombre: 'Test Delegación',
      descripcion: null,
      condicionMontoMin: null,
      condicionMontoMax: null,
      monedaCondicion: null,
    });

    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 1,
      nombre: 'Delegable',
      tipoAprobador: 'USUARIO',
      aprobadorId: userA,
      permiteDelegacion: true,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    const instancia = await workflowService.iniciarFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_delegacion',
      documentoId: newId(),
      documentoTabla: 'requisicion',
      monto: null,
      moneda: null,
      descripcion: 'Requisición delegable',
      metadata: null,
    });

    const [aprobacion] = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(and(
        eq(schema.aprobacionesPaso.instanciaId, instancia.id),
        eq(schema.aprobacionesPaso.estado, 'PENDIENTE'),
      ));
    expect(aprobacion!.aprobadorId).toBe(userA);

    // A delega a B
    const nuevaAprobacion = await workflowService.delegar(aprobacion!.id, userA, {
      delegadoAId: userB,
      comentario: 'Estoy de viaje',
    });

    // La nueva aprobación debe ser para B, con delegadoPor = A
    expect(nuevaAprobacion.aprobadorId).toBe(userB);
    expect(nuevaAprobacion.delegadoPor).toBe(userA);
    expect(nuevaAprobacion.estado).toBe('PENDIENTE');

    // La original debe estar DELEGADO
    const [original] = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(eq(schema.aprobacionesPaso.id, aprobacion!.id));
    expect(original!.estado).toBe('DELEGADO');

    // B aprueba
    await workflowService.aprobar(nuevaAprobacion.id, userB, { comentario: 'Delegado aprueba' });

    const final = await workflowService.findInstanciaById(instancia.id);
    expect(final.estado).toBe('APROBADO');
  });

  // ─── 6. Cancelar flujo EN_PROGRESO → CANCELADO ───────────────────────────

  it('6. Cancelar flujo EN_PROGRESO → instancia CANCELADO y aprobaciones RECHAZADO', async () => {
    const tipo = await tipoFlujoService.crearTipoFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_cancelar',
      nombre: 'Test Cancelación',
      descripcion: null,
      condicionMontoMin: null,
      condicionMontoMax: null,
      monedaCondicion: null,
    });

    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 1,
      nombre: 'Aprobador cancelable',
      tipoAprobador: 'USUARIO',
      aprobadorId: userA,
      permiteDelegacion: true,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    const instancia = await workflowService.iniciarFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_cancelar',
      documentoId: newId(),
      documentoTabla: 'pago',
      monto: null,
      moneda: null,
      descripcion: 'Pago a cancelar',
      metadata: null,
    });

    const cancelada = await workflowService.cancelarFlujo(instancia.id, SYSTEM_USER_ID, {
      motivo: 'Ya no es necesario',
    });

    expect(cancelada.estado).toBe('CANCELADO');
    expect(cancelada.finalizadoEn).not.toBeNull();

    // Las aprobaciones pendientes deben estar RECHAZADO
    const aprobaciones = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(eq(schema.aprobacionesPaso.instanciaId, instancia.id));

    expect(aprobaciones.every((a) => a.estado === 'RECHAZADO')).toBe(true);
  });

  // ─── 8. Aprobador no asignado recibe ForbiddenException ─────────────────

  it('8. Usuario no asignado al paso no puede aprobar (ForbiddenException)', async () => {
    const tipo = await tipoFlujoService.crearTipoFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_forbidden',
      nombre: 'Test Aprobador Incorrecto',
      descripcion: null,
      condicionMontoMin: null,
      condicionMontoMax: null,
      monedaCondicion: null,
    });

    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 1,
      nombre: 'Solo userA puede aprobar',
      tipoAprobador: 'USUARIO',
      aprobadorId: userA,
      permiteDelegacion: false,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    const instancia = await workflowService.iniciarFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_forbidden',
      documentoId: newId(),
      documentoTabla: 'orden_compra',
      monto: null,
      moneda: null,
      descripcion: 'OC aprobador incorrecto',
      metadata: null,
    });

    const [aprobacion] = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(eq(schema.aprobacionesPaso.instanciaId, instancia.id));

    expect(aprobacion!.aprobadorId).toBe(userA);

    // userB intenta aprobar la aprobación asignada a userA → ForbiddenException
    await expect(
      workflowService.aprobar(aprobacion!.id, userB, { comentario: 'Intento no autorizado' }),
    ).rejects.toThrow('Solo el aprobador asignado puede responder esta aprobación.');

    // La instancia debe seguir EN_PROGRESO (no avanzó)
    const sinCambio = await workflowService.findInstanciaById(instancia.id);
    expect(sinCambio.estado).toBe('EN_PROGRESO');
  });

  // ─── 7. Rechazo en multi-paso cancela pendientes restantes ───────────────

  it('7. Rechazo en flujo multi-paso cancela todas las aprobaciones pendientes restantes', async () => {
    const tipo = await tipoFlujoService.crearTipoFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_rechazo_cascada',
      nombre: 'Test Rechazo en Cascada',
      descripcion: null,
      condicionMontoMin: null,
      condicionMontoMax: null,
      monedaCondicion: null,
    });

    // Paso 1 paralelo: A y B deben aprobar
    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 1,
      nombre: 'Aprobador A',
      tipoAprobador: 'USUARIO',
      aprobadorId: userA,
      permiteDelegacion: false,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    await tipoFlujoService.agregarPaso(tipo.id, tenantId, SYSTEM_USER_ID, {
      orden: 1,
      nombre: 'Aprobador B',
      tipoAprobador: 'USUARIO',
      aprobadorId: userB,
      permiteDelegacion: false,
      vencimientoHoras: null,
      escalacionAprobadorId: null,
    });

    const instancia = await workflowService.iniciarFlujo(tenantId, SYSTEM_USER_ID, {
      tipoDocumento: 'test_rechazo_cascada',
      documentoId: newId(),
      documentoTabla: 'nomina',
      monto: null,
      moneda: null,
      descripcion: 'Nómina multi-paso',
      metadata: null,
    });

    const pendientes = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(and(
        eq(schema.aprobacionesPaso.instanciaId, instancia.id),
        eq(schema.aprobacionesPaso.estado, 'PENDIENTE'),
      ));
    expect(pendientes).toHaveLength(2);

    const aprobA = pendientes.find((a) => a.aprobadorId === userA)!;
    const aprobB = pendientes.find((a) => a.aprobadorId === userB)!;

    // A rechaza → todo el flujo debe rechazarse, incluyendo la aprobación pendiente de B
    await workflowService.rechazar(aprobA.id, userA, { comentario: 'Rechazado' });

    const final = await workflowService.findInstanciaById(instancia.id);
    expect(final.estado).toBe('RECHAZADO');

    // La aprobación de B debe quedar RECHAZADO también (cascada)
    const [aprobBFinal] = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(eq(schema.aprobacionesPaso.id, aprobB.id));
    expect(aprobBFinal!.estado).toBe('RECHAZADO');

    // Verificar que no hay ninguna PENDIENTE en la instancia
    const pendientesRestantes = await adminDb
      .select()
      .from(schema.aprobacionesPaso)
      .where(and(
        eq(schema.aprobacionesPaso.instanciaId, instancia.id),
        eq(schema.aprobacionesPaso.estado, 'PENDIENTE'),
      ));
    expect(pendientesRestantes).toHaveLength(0);
  });
});
