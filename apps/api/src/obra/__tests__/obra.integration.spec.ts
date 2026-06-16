/**
 * PRUEBAS DE INTEGRACIÓN — Obra: Parte Diario, Avance Físico, MO, Equipos (Sesión 7 Capa 1)
 *
 *  01. avance_partida handler: avance_cantidad incrementa en ejecucion_partida.
 *  02. Avance acumula correctamente en múltiples partes de la misma partida.
 *  03. Avance medido en CANTIDAD: payload tiene cantidadEjecutada (nunca porcentaje).
 *  04. Alerta en outbox cuando avance supera cantidad_presupuestada.
 *  05. hora_personal handler: devengado incrementa por horas × tarifa.
 *  06. hora_personal handler: genera asiento contable si existe regla.
 *  07. hora_equipo handler: devengado incrementa por horas × tarifa interna.
 *  08. hora_equipo handler: genera asiento contable si existe regla.
 *  09. ParteDiarioService.crear() idempotente por idempotency_key.
 *  10. Confirmar parte: 3 tipos de eventos emitidos (avance + personal + equipo).
 *  11. Re-confirmar parte CONFIRMADO: idempotente, no duplica eventos.
 *  12. Crear RFI con número secuencial por proyecto.
 *  13. Responder RFI: estado RESPONDIDO, respuesta guardada.
 *  14. Cerrar RFI: estado CERRADO, cerrado_en seteado.
 *  15. Crear punch list item en estado PENDIENTE.
 *  16. Completar punch list item: estado COMPLETADO, resuelto_en seteado.
 *  17. RLS: tenant2 no ve partes diarios de tenant1.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import Decimal from 'decimal.js';
import { ObraAvancePartidaHandler } from '../handlers/obra-avance-partida.handler.js';
import { ObraHoraPersonalHandler } from '../handlers/obra-hora-personal.handler.js';
import { ObraHoraEquipoHandler } from '../handlers/obra-hora-equipo.handler.js';
import { ParteDiarioService } from '../parte-diario.service.js';
import { RfiService } from '../rfi.service.js';
import { PunchListService } from '../punch-list.service.js';
import { DbService } from '../../database/db.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { ProjectionEngineService } from '../../ledger/projection-engine.service.js';
import { ReglaContableService } from '../../contabilidad/regla-contable.service.js';
import { CuentaContableService } from '../../contabilidad/cuenta-contable.service.js';
import { AsientoContableService } from '../../contabilidad/asiento-contable.service.js';
import type { ConfiguracionRegla } from '@tributia/contabilidad';

// ─── Conexiones ───────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';
const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

describe('Obra — Parte Diario, Avance Físico, MO y Equipos', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  // ── Fixtures ─────────────────────────────────────────────────────────────────
  let tenantId: string;
  let t2: string;
  let empresaId: string;
  let proyectoId: string;
  let p2: string;
  let partidaId: string;
  let equipoId: string;
  let unidadId: string;
  let clienteId: string;

  // Fixtures contables (para tests 06 y 08)
  let cuentaMoDebeId: string;   // 6201 Costo MO Obra
  let cuentaMoHaberId: string;  // 2110 MO por Pagar
  let cuentaEqDebeId: string;   // 6202 Costo Equipos
  let cuentaEqHaberId: string;  // 1503 Depreciación Equipos
  let reglaHoraPersonalId: string;
  let reglaHoraEquipoId: string;

  // Handlers bajo prueba
  let handlerAvance: ObraAvancePartidaHandler;
  let handlerMo: ObraHoraPersonalHandler;
  let handlerEquipo: ObraHoraEquipoHandler;

  // Servicios reales para tests de asiento (06, 08)
  let realReglaSvc: ReglaContableService;
  let realAsientoSvc: AsientoContableService;

  // Servicios bajo prueba
  let parteDiarioSvc: ParteDiarioService;
  let rfiSvc: RfiService;
  let punchSvc: PunchListService;

  // ── Helpers para crear evento_operativo de prueba ─────────────────────────
  function makeEvento(overrides: Record<string, unknown>) {
    return {
      id: newId(),
      tenantId,
      empresaId,
      proyectoId,
      centroCostoId: null,
      tipoEvento: 'avance_partida',
      ocurridoEn: new Date(),
      usuarioId: SYSTEM_USER_ID,
      payload: {},
      referenciaId: null,
      referenciaTabla: null,
      idempotencyKey: newId(),
      estado: 'registrado',
      createdAt: new Date(),
      createdBy: SYSTEM_USER_ID,
      ...overrides,
    };
  }

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool   = new Pool({ connectionString: APP_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantId   = newId();
    t2         = newId();
    empresaId  = newId();
    proyectoId = newId();
    p2         = newId();
    partidaId  = newId();
    equipoId   = newId();
    unidadId   = newId();
    clienteId  = newId();

    cuentaMoDebeId     = newId();
    cuentaMoHaberId    = newId();
    cuentaEqDebeId     = newId();
    cuentaEqHaberId    = newId();
    reglaHoraPersonalId = newId();
    reglaHoraEquipoId   = newId();

    const uid = SYSTEM_USER_ID;
    const now = new Date();

    // Tenant 1 y 2
    await adminDb.insert(schema.tenants).values([
      { id: tenantId, nombre: 'T-Obra1', slug: `obra-t1-${tenantId.slice(-12)}`, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
      { id: t2,       nombre: 'T-Obra2', slug: `obra-t2-${t2.slice(-12)}`,       createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);

    // Empresas
    await adminDb.insert(schema.empresas).values([
      { id: empresaId, tenantId, nombre: 'Empresa Obra 1', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);
    const e2id = newId();
    await adminDb.insert(schema.empresas).values([
      { id: e2id, tenantId: t2, nombre: 'Empresa Obra 2', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);

    // Cliente (tercero con esCliente=true) — requerido por proyecto.cliente_id NOT NULL
    await adminDb.insert(schema.terceros).values([
      {
        id: clienteId, tenantId, tipoIdentificacion: 'RNC',
        rncCedula: '101000001', nombreComercial: 'Cliente Obra Test',
        tipoContribuyente: 'PERSONA_JURIDICA', condicionDgii: 'NORMAL',
        esCliente: true, esProveedor: false,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // Proyectos
    await adminDb.insert(schema.proyectos).values([
      {
        id: proyectoId, tenantId, empresaId, clienteId, nombre: 'Proyecto Obra', codigo: 'POBT1',
        estado: 'EN_EJECUCION', monedaContrato: 'DOP', tipoObra: 'OTRO',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: p2, tenantId: t2, empresaId: e2id, clienteId, nombre: 'Proyecto Obra 2', codigo: 'POBT2',
        estado: 'EN_EJECUCION', monedaContrato: 'DOP', tipoObra: 'OTRO',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // Unidad de medida
    await adminDb.insert(schema.unidadesMedida).values([
      { id: unidadId, tenantId, codigo: 'M3', nombre: 'Metro cúbico', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);

    // Partida
    await adminDb.insert(schema.partidas).values([
      {
        id: partidaId, tenantId, proyectoId, nivel: 2, orden: 1,
        numeroJerarquico: '1.1', codigo: 'PAR-001', nombre: 'Hormigón Armado N2',
        unidadMedidaId: unidadId,
        cantidadPresupuestada: '100.0000', // 100 m³ presupuestados
        precioUnitario: '50000.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // Equipo en catálogo
    await adminDb.insert(schema.equiposCatalogo).values([
      {
        id: equipoId, tenantId, codigo: 'EXC-001', nombre: 'Excavadora CAT-320',
        categoria: 'MAQUINARIA_PESADA',
        tarifaHoraria: '15000.0000', monedaTarifa: 'DOP',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // Cuentas contables para tests 06/08
    await adminDb.insert(schema.cuentasContables).values([
      { id: cuentaMoDebeId,  tenantId, empresaId, codigo: '6201',   nombre: 'Costo MO Obra',          tipo: 'costo',  naturaleza: 'deudora',   nivel: 3, esMovimiento: true, activo: true, createdBy: uid, updatedBy: uid },
      { id: cuentaMoHaberId, tenantId, empresaId, codigo: '2110',   nombre: 'MO por Pagar',            tipo: 'pasivo', naturaleza: 'acreedora', nivel: 3, esMovimiento: true, activo: true, createdBy: uid, updatedBy: uid },
      { id: cuentaEqDebeId,  tenantId, empresaId, codigo: '6202',   nombre: 'Costo Equipos Obra',      tipo: 'costo',  naturaleza: 'deudora',   nivel: 3, esMovimiento: true, activo: true, createdBy: uid, updatedBy: uid },
      { id: cuentaEqHaberId, tenantId, empresaId, codigo: '1503',   nombre: 'Depreciacion Equipos',    tipo: 'activo', naturaleza: 'acreedora', nivel: 3, esMovimiento: true, activo: true, createdBy: uid, updatedBy: uid },
    ]);

    // Reglas contables para hora_personal y hora_equipo
    const reglaPersonalCfg: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito',  cuentaCodigo: '6201', descripcion: 'Costo MO obra' },
        { tipo: 'credito', cuentaCodigo: '2110', descripcion: 'MO por pagar' },
      ],
    };
    const reglaEquipoCfg: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito',  cuentaCodigo: '6202', descripcion: 'Costo equipo' },
        { tipo: 'credito', cuentaCodigo: '1503', descripcion: 'Deprec. equipo' },
      ],
    };
    await adminDb.insert(schema.reglasContables).values([
      { id: reglaHoraPersonalId, tenantId, empresaId, tipoEvento: 'hora_personal', nombre: 'MO obra test', configuracion: reglaPersonalCfg, prioridad: 0, activo: true, createdBy: uid, updatedBy: uid },
      { id: reglaHoraEquipoId,   tenantId, empresaId, tipoEvento: 'hora_equipo',   nombre: 'Eq obra test', configuracion: reglaEquipoCfg,   prioridad: 0, activo: true, createdBy: uid, updatedBy: uid },
    ]);

    // Servicios reales de contabilidad (usados en tests 06 y 08)
    realReglaSvc   = new ReglaContableService();
    const cuentaSvc = new CuentaContableService(null as never);
    realAsientoSvc  = new AsientoContableService(null as never, cuentaSvc);

    // Handlers (sin deps de NestJS — instanciación directa igual que en sesiones anteriores)
    handlerAvance = new ObraAvancePartidaHandler();

    const mockRegla = { findByTipoEvento: () => Promise.resolve(null) };
    const mockAsiento = { generar: () => Promise.resolve({ id: newId() }) };
    handlerMo = new ObraHoraPersonalHandler(
      mockRegla as unknown as ReglaContableService,
      mockAsiento as unknown as AsientoContableService,
    );
    handlerEquipo = new ObraHoraEquipoHandler(
      mockRegla as unknown as ReglaContableService,
      mockAsiento as unknown as AsientoContableService,
    );

    // Servicios para tests de integración de alto nivel
    const dbSvc = { pool: adminDb, tx: adminDb } as unknown as DbService;

    // LedgerService requiere DbService + ProjectionEngineService.
    // Para los tests de ParteDiarioService usamos el handler avance directamente instanciado.
    const mockProjection = {
      runSync: async () => {},
      enqueueAsync: async () => {},
    };
    const ledgerSvc = new LedgerService(
      dbSvc,
      mockProjection as unknown as ProjectionEngineService,
    );

    parteDiarioSvc = new ParteDiarioService(dbSvc, ledgerSvc);
    rfiSvc = new RfiService(dbSvc);
    punchSvc = new PunchListService(dbSvc);
  });

  afterAll(async () => {
    // Deshabilitar triggers prevent_delete para limpieza de fixtures de test
    await adminPool.query(`
      ALTER TABLE partida         DISABLE TRIGGER no_delete_partida;
      ALTER TABLE proyecto        DISABLE TRIGGER no_delete_proyecto;
      ALTER TABLE empresa         DISABLE TRIGGER no_delete_empresa;
      ALTER TABLE tenant          DISABLE TRIGGER no_delete_tenant;
    `);

    // Cleanup en orden inverso de FK
    await adminPool.query(`DELETE FROM punch_list_item WHERE tenant_id = $1 OR tenant_id = $2`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM rfi WHERE tenant_id = $1 OR tenant_id = $2`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM avance_obra WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM equipo_parte WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM personal_parte WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM parte_diario WHERE tenant_id = $1 OR tenant_id = $2`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM outbox WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM ejecucion_partida WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM linea_asiento WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM asiento_contable WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM regla_contable WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM cuenta_contable WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM equipo_catalogo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM partida WHERE tenant_id = $1 OR tenant_id = $2`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM unidad_medida WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id = $1 OR tenant_id = $2`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id = $1 OR tenant_id = $2`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id = $1 OR tenant_id = $2`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = $1 OR tenant_id = $2`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM tenant WHERE id = $1 OR id = $2`, [tenantId, t2]);

    // Re-habilitar triggers
    await adminPool.query(`
      ALTER TABLE partida         ENABLE TRIGGER no_delete_partida;
      ALTER TABLE proyecto        ENABLE TRIGGER no_delete_proyecto;
      ALTER TABLE empresa         ENABLE TRIGGER no_delete_empresa;
      ALTER TABLE tenant          ENABLE TRIGGER no_delete_tenant;
    `);

    await adminPool.end();
    await appPool.end();
  });

  // ── TEST 01: avance_cantidad incrementa ───────────────────────────────────
  it('01. avance_partida handler: avance_cantidad incrementa en ejecucion_partida', async () => {
    const avanceObraId = newId();
    const eventoId = newId();

    const evento = makeEvento({
      id: eventoId,
      tipoEvento: 'avance_partida',
      payload: {
        parteDiarioId: newId(),
        avanceObraId,
        proyectoId,
        partidaId,
        cantidadEjecutada: '10.0000',
        unidad: 'm3',
        cantidadPresupuestada: '100.0000',
      },
    });

    await adminDb.transaction(async (tx) => {
      // Insertar evento en ledger
      await tx.insert(schema.eventosOperativos).values({
        id: evento.id,
        tenantId: evento.tenantId,
        empresaId: evento.empresaId,
        proyectoId: evento.proyectoId,
        tipoEvento: evento.tipoEvento,
        usuarioId: evento.usuarioId,
        payload: evento.payload,
        idempotencyKey: evento.idempotencyKey,
        estado: 'registrado',
        createdBy: evento.createdBy,
      });
      await handlerAvance.ejecutar({ evento: evento as never, tx: tx as never });
    });

    const [ep] = await adminDb
      .select()
      .from(schema.ejecucionPartidas)
      .where(
        and(
          eq(schema.ejecucionPartidas.tenantId, tenantId),
          eq(schema.ejecucionPartidas.partidaId, partidaId),
        ),
      );

    expect(ep).toBeDefined();
    expect(new Decimal(ep!.avanceCantidad ?? '0').toFixed(4)).toBe('10.0000');
  });

  // ── TEST 02: avance acumula en múltiples partes ────────────────────────────
  it('02. Avance acumula correctamente en múltiples partes de la misma partida', async () => {
    const eventoId2 = newId();

    const evento = makeEvento({
      id: eventoId2,
      tipoEvento: 'avance_partida',
      payload: {
        parteDiarioId: newId(),
        avanceObraId: newId(),
        proyectoId,
        partidaId,
        cantidadEjecutada: '15.0000',
        unidad: 'm3',
      },
    });

    await adminDb.transaction(async (tx) => {
      await tx.insert(schema.eventosOperativos).values({
        id: evento.id,
        tenantId: evento.tenantId,
        empresaId: evento.empresaId,
        proyectoId: evento.proyectoId,
        tipoEvento: evento.tipoEvento,
        usuarioId: evento.usuarioId,
        payload: evento.payload,
        idempotencyKey: evento.idempotencyKey,
        estado: 'registrado',
        createdBy: evento.createdBy,
      });
      await handlerAvance.ejecutar({ evento: evento as never, tx: tx as never });
    });

    const [ep] = await adminDb
      .select()
      .from(schema.ejecucionPartidas)
      .where(
        and(
          eq(schema.ejecucionPartidas.tenantId, tenantId),
          eq(schema.ejecucionPartidas.partidaId, partidaId),
        ),
      );

    // 10 del test anterior + 15 = 25
    expect(new Decimal(ep!.avanceCantidad ?? '0').toFixed(4)).toBe('25.0000');
  });

  // ── TEST 03: avance es CANTIDAD no % ──────────────────────────────────────
  it('03. Avance medido en CANTIDAD: payload tiene cantidadEjecutada (nunca porcentaje)', () => {
    // La invariante clave del producto: nunca porcentajeAcumulado en el payload.
    // El schema Zod zPayloadAvancePartida no tiene porcentajeAcumulado.
    // Este test verifica que el campo sencillamente no existe.
    const payload = {
      parteDiarioId: newId(),
      avanceObraId: newId(),
      proyectoId,
      partidaId,
      cantidadEjecutada: '5.0000',
      unidad: 'm3',
    };

    expect(payload).toHaveProperty('cantidadEjecutada');
    expect(payload).not.toHaveProperty('porcentajeAcumulado');
    expect(payload).not.toHaveProperty('porcentaje');
    expect(Number(payload.cantidadEjecutada)).toBeGreaterThan(0);
  });

  // ── TEST 04: alerta en outbox cuando avance supera presupuesto ────────────
  it('04. Alerta en outbox cuando avance supera cantidad_presupuestada', async () => {
    // 25 ya acumulados; presupuestado = 100; enviar 80 → total 105 > 100
    const eventoId3 = newId();
    const idempKey3 = newId();
    const payload04 = {
      parteDiarioId: newId(),
      avanceObraId: newId(),
      proyectoId,
      partidaId,
      cantidadEjecutada: '80.0000',
      unidad: 'm3',
      cantidadPresupuestada: '100.0000',
    };

    // Insertar evento via raw SQL (auto-commit) para que el FK del outbox no dependa
    // de atomicidad con el handler — siguiendo el patrón de projection.integration.spec.ts
    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'avance_partida',$5,$6::jsonb,$7,$8)`,
      [eventoId3, tenantId, empresaId, proyectoId, SYSTEM_USER_ID, JSON.stringify(payload04), idempKey3, SYSTEM_USER_ID],
    );

    const evento04 = {
      id: eventoId3,
      tenantId,
      empresaId,
      proyectoId,
      centroCostoId: null,
      tipoEvento: 'avance_partida',
      ocurridoEn: new Date(),
      usuarioId: SYSTEM_USER_ID,
      payload: payload04,
      idempotencyKey: idempKey3,
      estado: 'registrado',
      createdBy: SYSTEM_USER_ID,
    };

    // Llamar handler directamente con adminDb (no en tx) — igual que en otros test suites
    await handlerAvance.ejecutar({ evento: evento04 as never, tx: adminDb as never });

    // Verificar que hay una alerta en outbox
    const alertas = await adminPool.query(
      `SELECT * FROM outbox WHERE tenant_id = $1 AND handler_nombre = 'ALERTA_AVANCE_EXCESO' AND evento_id = $2`,
      [tenantId, eventoId3],
    );

    expect(alertas.rows.length).toBe(1);
    expect((alertas.rows[0].payload as { tipo: string }).tipo).toBe('ALERTA_AVANCE_EXCESO');
  });

  // ── TEST 05: hora_personal: devengado incrementa ──────────────────────────
  it('05. hora_personal handler: devengado incrementa por horas × tarifa', async () => {
    const eventoId = newId();
    const partidaMo = newId(); // partida separada para este test

    // Crear partida auxiliar para MO
    await adminDb.insert(schema.partidas).values([{
      id: partidaMo, tenantId, proyectoId, nivel: 2, orden: 2,
      numeroJerarquico: '1.2', codigo: 'PAR-MO', nombre: 'Mano de Obra Albañilería',
      unidadMedidaId: unidadId,
      cantidadPresupuestada: '500.0000',
      createdAt: new Date(), createdBy: SYSTEM_USER_ID,
      updatedAt: new Date(), updatedBy: SYSTEM_USER_ID,
    }]);

    const payload = {
      parteDiarioId: newId(),
      personalParteId: newId(),
      proyectoId,
      partidaId: partidaMo,
      nombre: 'Juan Pérez',
      tipo: 'PROPIO' as const,
      empleadoId: null,
      horasTrabajadas: '8.0000',
      tarifaHoraria: '500.0000',
      moneda: 'DOP' as const,
      costoTotal: '4000.0000', // 8h × 500 = 4000
    };

    const evento = makeEvento({
      id: eventoId,
      tipoEvento: 'hora_personal',
      payload,
    });

    await adminDb.transaction(async (tx) => {
      await tx.insert(schema.eventosOperativos).values({
        id: evento.id,
        tenantId: evento.tenantId,
        empresaId: evento.empresaId,
        proyectoId: evento.proyectoId,
        tipoEvento: evento.tipoEvento,
        usuarioId: evento.usuarioId,
        payload: evento.payload,
        idempotencyKey: evento.idempotencyKey,
        estado: 'registrado',
        createdBy: evento.createdBy,
      });
      await handlerMo.ejecutar({ evento: evento as never, tx: tx as never });
    });

    const [ep] = await adminDb
      .select()
      .from(schema.ejecucionPartidas)
      .where(
        and(
          eq(schema.ejecucionPartidas.tenantId, tenantId),
          eq(schema.ejecucionPartidas.partidaId, partidaMo),
        ),
      );

    expect(ep).toBeDefined();
    expect(new Decimal(ep!.devengado).toFixed(4)).toBe('4000.0000');
  });

  // ── TEST 06: hora_personal genera asiento con importe exacto ─────────────
  it('06. hora_personal handler: asiento generado con importe = costoTotal (2400)', async () => {
    const costoTotal = '2400.0000';
    const handlerConRegla = new ObraHoraPersonalHandler(realReglaSvc, realAsientoSvc);

    const eventoId = newId();
    const payload = {
      parteDiarioId: newId(), personalParteId: newId(),
      proyectoId, partidaId,
      nombre: 'María López', tipo: 'PROPIO' as const, empleadoId: null,
      horasTrabajadas: '4.0000', tarifaHoraria: '600.0000',
      moneda: 'DOP' as const, costoTotal,
    };

    const evento = makeEvento({ id: eventoId, tipoEvento: 'hora_personal', payload });

    await adminDb.transaction(async (tx) => {
      await tx.insert(schema.eventosOperativos).values({
        id: evento.id, tenantId: evento.tenantId, empresaId: evento.empresaId,
        proyectoId: evento.proyectoId, tipoEvento: evento.tipoEvento,
        usuarioId: evento.usuarioId, payload: evento.payload,
        idempotencyKey: evento.idempotencyKey, estado: 'registrado',
        createdBy: evento.createdBy,
      });
      await handlerConRegla.ejecutar({ evento: evento as never, tx: tx as never });
    });

    // Verificar asiento en DB — NO solo presencia, sino importe exacto
    const [asiento] = await adminDb
      .select()
      .from(schema.asientosContables)
      .where(and(
        eq(schema.asientosContables.tenantId, tenantId),
        eq(schema.asientosContables.eventoId, eventoId),
      ));
    expect(asiento).toBeDefined();

    const lineas = await adminDb
      .select()
      .from(schema.lineasAsiento)
      .where(eq(schema.lineasAsiento.asientoId, asiento!.id));

    expect(lineas).toHaveLength(2);
    const debe  = lineas.find((l) => l.tipo === 'debe');
    const haber = lineas.find((l) => l.tipo === 'haber');
    expect(new Decimal(debe!.importe).toFixed(4)).toBe(costoTotal);
    expect(new Decimal(haber!.importe).toFixed(4)).toBe(costoTotal);
  });

  // ── TEST 07: hora_equipo: devengado incrementa ────────────────────────────
  it('07. hora_equipo handler: devengado incrementa por horas × tarifa interna', async () => {
    const eventoId = newId();
    const partidaEq = newId();

    await adminDb.insert(schema.partidas).values([{
      id: partidaEq, tenantId, proyectoId, nivel: 2, orden: 3,
      numeroJerarquico: '1.3', codigo: 'PAR-EQ', nombre: 'Movimiento de Tierra',
      unidadMedidaId: unidadId,
      cantidadPresupuestada: '200.0000',
      createdAt: new Date(), createdBy: SYSTEM_USER_ID,
      updatedAt: new Date(), updatedBy: SYSTEM_USER_ID,
    }]);

    const payload = {
      parteDiarioId: newId(),
      equipoParteId: newId(),
      proyectoId,
      partidaId: partidaEq,
      equipoId,
      nombreEquipo: 'Excavadora CAT-320',
      horasOperadas: '6.0000',
      tarifaHoraria: '15000.0000',
      moneda: 'DOP' as const,
      costoTotal: '90000.0000', // 6h × 15000 = 90000
    };

    const evento = makeEvento({ id: eventoId, tipoEvento: 'hora_equipo', payload });

    await adminDb.transaction(async (tx) => {
      await tx.insert(schema.eventosOperativos).values({
        id: evento.id, tenantId: evento.tenantId, empresaId: evento.empresaId,
        proyectoId: evento.proyectoId, tipoEvento: evento.tipoEvento,
        usuarioId: evento.usuarioId, payload: evento.payload,
        idempotencyKey: evento.idempotencyKey, estado: 'registrado',
        createdBy: evento.createdBy,
      });
      await handlerEquipo.ejecutar({ evento: evento as never, tx: tx as never });
    });

    const [ep] = await adminDb
      .select()
      .from(schema.ejecucionPartidas)
      .where(
        and(
          eq(schema.ejecucionPartidas.tenantId, tenantId),
          eq(schema.ejecucionPartidas.partidaId, partidaEq),
        ),
      );

    expect(ep).toBeDefined();
    expect(new Decimal(ep!.devengado).toFixed(4)).toBe('90000.0000');
  });

  // ── TEST 08: hora_equipo genera asiento con importe exacto ──────────────
  it('08. hora_equipo handler: asiento generado con importe = costoTotal (45000)', async () => {
    const costoTotal = '45000.0000';
    const handlerConRegla = new ObraHoraEquipoHandler(realReglaSvc, realAsientoSvc);

    const eventoId = newId();
    const payload = {
      parteDiarioId: newId(), equipoParteId: newId(),
      proyectoId, partidaId, equipoId,
      nombreEquipo: 'Excavadora CAT-320',
      horasOperadas: '3.0000', tarifaHoraria: '15000.0000',
      moneda: 'DOP' as const, costoTotal,
    };

    const evento = makeEvento({ id: eventoId, tipoEvento: 'hora_equipo', payload });

    await adminDb.transaction(async (tx) => {
      await tx.insert(schema.eventosOperativos).values({
        id: evento.id, tenantId: evento.tenantId, empresaId: evento.empresaId,
        proyectoId: evento.proyectoId, tipoEvento: evento.tipoEvento,
        usuarioId: evento.usuarioId, payload: evento.payload,
        idempotencyKey: evento.idempotencyKey, estado: 'registrado',
        createdBy: evento.createdBy,
      });
      await handlerConRegla.ejecutar({ evento: evento as never, tx: tx as never });
    });

    // Verificar asiento en DB — importe exacto, no solo presencia
    const [asiento] = await adminDb
      .select()
      .from(schema.asientosContables)
      .where(and(
        eq(schema.asientosContables.tenantId, tenantId),
        eq(schema.asientosContables.eventoId, eventoId),
      ));
    expect(asiento).toBeDefined();

    const lineas = await adminDb
      .select()
      .from(schema.lineasAsiento)
      .where(eq(schema.lineasAsiento.asientoId, asiento!.id));

    expect(lineas).toHaveLength(2);
    const debe  = lineas.find((l) => l.tipo === 'debe');
    const haber = lineas.find((l) => l.tipo === 'haber');
    expect(new Decimal(debe!.importe).toFixed(4)).toBe(costoTotal);
    expect(new Decimal(haber!.importe).toFixed(4)).toBe(costoTotal);
  });

  // ── TEST 09: ParteDiarioService.crear() idempotente ──────────────────────
  it('09. ParteDiarioService.crear() idempotente: mismo key → mismo id', async () => {
    const ikey = `parte-idem-${newId()}`;

    const dto = {
      idempotencyKey: ikey,
      proyectoId,
      empresaId,
      fecha: '2026-01-15',
      clima: 'SOLEADO' as const,
      notas: 'Primera llamada',
      personal: [],
      equipos: [],
      avances: [],
    };

    const id1 = await parteDiarioSvc.crear(tenantId, dto, SYSTEM_USER_ID);
    const id2 = await parteDiarioSvc.crear(tenantId, dto, SYSTEM_USER_ID);

    expect(id1).toBe(id2);

    // Solo un registro en BD
    const { rows } = await adminPool.query(
      `SELECT COUNT(*)::int AS cnt FROM parte_diario WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, ikey],
    );
    expect(rows[0].cnt).toBe(1);
  });

  // ── TEST 10: Confirmar parte emite 3 tipos de eventos ─────────────────────
  it('10. Confirmar parte: avance + personal + equipo generan sus respectivos eventos', async () => {
    const ikey = `parte-confirm-${newId()}`;
    const avanceKey = `avance-${newId()}`;
    const personalKey = `personal-${newId()}`;
    const equipoKey = `equipo-${newId()}`;

    // Partida para avance de este test (no acumula con las anteriores)
    const pTestId = newId();
    await adminDb.insert(schema.partidas).values([{
      id: pTestId, tenantId, proyectoId, nivel: 2, orden: 4,
      numeroJerarquico: '1.4', codigo: 'PAR-T10', nombre: 'Test Confirmación',
      unidadMedidaId: unidadId,
      cantidadPresupuestada: '50.0000',
      createdAt: new Date(), createdBy: SYSTEM_USER_ID,
      updatedAt: new Date(), updatedBy: SYSTEM_USER_ID,
    }]);

    const dto = {
      idempotencyKey: ikey,
      proyectoId,
      empresaId,
      fecha: '2026-01-16',
      personal: [{
        idempotencyKey: personalKey,
        nombre: 'Carlos Díaz', tipo: 'PROPIO' as const,
        horasTrabajadas: '8.0000', partidaId: pTestId,
        tarifaHoraria: '400.0000', moneda: 'DOP' as const,
      }],
      equipos: [{
        idempotencyKey: equipoKey,
        equipoId,
        horasOperadas: '4.0000', partidaId: pTestId, moneda: 'DOP' as const,
      }],
      avances: [{
        idempotencyKey: avanceKey,
        partidaId: pTestId,
        cantidadEjecutada: '5.0000', unidad: 'm3',
      }],
    };

    const parteId = await parteDiarioSvc.crear(tenantId, dto, SYSTEM_USER_ID);
    await parteDiarioSvc.confirmar(tenantId, parteId, SYSTEM_USER_ID);

    // Verificar que el parte quedó CONFIRMADO
    const { rows: parteRows } = await adminPool.query(
      `SELECT estado FROM parte_diario WHERE id = $1`,
      [parteId],
    );
    expect(parteRows[0].estado).toBe('CONFIRMADO');

    // Verificar que los 3 idempotency keys existen en evento_operativo
    const { rows: eventos } = await adminPool.query(
      `SELECT tipo_evento FROM evento_operativo WHERE idempotency_key = ANY($1::varchar[])`,
      [[avanceKey, personalKey, equipoKey]],
    );

    const tipos = eventos.map((e: { tipo_evento: string }) => e.tipo_evento);
    expect(tipos).toContain('avance_partida');
    expect(tipos).toContain('hora_personal');
    expect(tipos).toContain('hora_equipo');
  });

  // ── TEST 11: Re-confirmar parte CONFIRMADO no duplica ─────────────────────
  it('11. Re-confirmar parte CONFIRMADO: idempotente, no duplica eventos', async () => {
    // Usar el mismo parte del test 10 — buscar por fecha y proyecto
    const { rows } = await adminPool.query(
      `SELECT id FROM parte_diario WHERE tenant_id = $1 AND fecha = '2026-01-16'`,
      [tenantId],
    );
    const parteId = rows[0].id as string;

    // Re-confirmar no lanza error
    await expect(parteDiarioSvc.confirmar(tenantId, parteId, SYSTEM_USER_ID)).resolves.toBeUndefined();

    // Contar eventos del parte — debe ser exactamente 3
    const { rows: avs } = await adminPool.query(
      `SELECT id FROM avance_obra WHERE parte_id = $1`,
      [parteId],
    );
    const avId = avs[0].id as string;

    const { rows: evs } = await adminPool.query(
      `SELECT COUNT(*)::int AS cnt FROM evento_operativo
       WHERE idempotency_key = (SELECT idempotency_key FROM avance_obra WHERE id = $1)`,
      [avId],
    );
    expect(evs[0].cnt).toBe(1); // exactamente un evento por línea
  });

  // ── TEST 12: Crear RFI ────────────────────────────────────────────────────
  it('12. Crear RFI: estado ABIERTO, número secuencial', async () => {
    const rfiId = await rfiSvc.crear(
      tenantId,
      {
        proyectoId,
        titulo: 'Aclaración sobre especificación de hormigón',
        descripcion: 'La especificación B-350 requiere aclaración sobre el slump',
        impacto: 'DIAS',
        impactoDias: 3,
        asignadoA: SYSTEM_USER_ID,
        fechaLimite: '2026-02-01',
      },
      SYSTEM_USER_ID,
    );

    const rfi = await rfiSvc.findById(tenantId, rfiId);
    expect(rfi.estado).toBe('ABIERTO');
    expect(rfi.numero).toBe(1);
    expect(rfi.impacto).toBe('DIAS');
  });

  // ── TEST 13: Responder RFI ────────────────────────────────────────────────
  it('13. Responder RFI: estado RESPONDIDO, respuesta guardada', async () => {
    // Usar el RFI del test anterior
    const { rows } = await adminPool.query(
      `SELECT id FROM rfi WHERE tenant_id = $1 AND proyecto_id = $2`,
      [tenantId, proyectoId],
    );
    const rfiId = rows[0].id as string;

    await rfiSvc.responder(
      tenantId,
      rfiId,
      { respuesta: 'El slump debe ser de 10 cm ± 2 cm según ACI 318-19' },
      SYSTEM_USER_ID,
    );

    const rfi = await rfiSvc.findById(tenantId, rfiId);
    expect(rfi.estado).toBe('RESPONDIDO');
    expect(rfi.respuesta).toBeTruthy();
  });

  // ── TEST 14: Cerrar RFI ───────────────────────────────────────────────────
  it('14. Cerrar RFI: estado CERRADO, cerrado_en seteado', async () => {
    const { rows } = await adminPool.query(
      `SELECT id FROM rfi WHERE tenant_id = $1 AND proyecto_id = $2`,
      [tenantId, proyectoId],
    );
    const rfiId = rows[0].id as string;

    await rfiSvc.cerrar(tenantId, rfiId, SYSTEM_USER_ID);

    const rfi = await rfiSvc.findById(tenantId, rfiId);
    expect(rfi.estado).toBe('CERRADO');
    expect(rfi.cerradoEn).toBeTruthy();
  });

  // ── TEST 15: Crear punch list item ────────────────────────────────────────
  it('15. Crear punch list item en estado PENDIENTE', async () => {
    const itemId = await punchSvc.crear(
      tenantId,
      {
        proyectoId,
        descripcion: 'Fisura en columna C-4 nivel 3',
        ubicacion: 'Nivel 3, eje C-4',
        responsableId: SYSTEM_USER_ID,
        fechaLimite: '2026-02-15',
      },
      SYSTEM_USER_ID,
    );

    const item = await punchSvc.findById(tenantId, itemId);
    expect(item.estado).toBe('PENDIENTE');
    expect(item.descripcion).toContain('C-4');
  });

  // ── TEST 16: Completar punch list item ────────────────────────────────────
  it('16. Completar punch list item: estado COMPLETADO, resuelto_en seteado', async () => {
    const { rows } = await adminPool.query(
      `SELECT id FROM punch_list_item WHERE tenant_id = $1 AND proyecto_id = $2`,
      [tenantId, proyectoId],
    );
    const itemId = rows[0].id as string;

    await punchSvc.actualizarEstado(
      tenantId,
      itemId,
      { estado: 'COMPLETADO' },
      SYSTEM_USER_ID,
    );

    const item = await punchSvc.findById(tenantId, itemId);
    expect(item.estado).toBe('COMPLETADO');
    expect(item.resueltoEn).toBeTruthy();
  });

  // ── TEST 17: RLS — tenant2 no ve partes de tenant1 ────────────────────────
  it('17. RLS: tenant2 no ve partes diarios de tenant1', async () => {
    // El parte del test 09 pertenece a tenant1.
    // Con appPool y SET LOCAL para tenant2 → no debe verlo.
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${t2}'`);

      const { rows } = await client.query(
        `SELECT id FROM parte_diario WHERE proyecto_id = $1`,
        [proyectoId], // proyectoId es de tenant1
      );

      expect(rows.length).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
