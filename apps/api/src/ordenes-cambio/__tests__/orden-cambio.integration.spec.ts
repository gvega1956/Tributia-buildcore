/**
 * PRUEBAS DE INTEGRACIÓN — Órdenes de Cambio (Sesión 8 Capa 1)
 *
 *  01. Crear OC en BORRADOR con número secuencial por proyecto.
 *  02. Agregar línea a OC BORRADOR — montoEstimado se actualiza.
 *  03. Rechaza agregar línea si OC no está en BORRADOR.
 *  04. Enviar al cliente (BORRADOR → ENVIADO_CLIENTE).
 *  05. Rechaza enviarAlCliente si no hay líneas.
 *  06. Rechaza enviarAlCliente si OC no está en BORRADOR.
 *  07. Aprobar OC (ENVIADO_CLIENTE → APROBADO, monto_aprobado guardado).
 *  08. Aprobar actualiza proyecto.presupuesto_vigente_monto.
 *  09. Aprobar genera evento orden_cambio_aprobada en evento_operativo.
 *  10. Aprobar NO modifica linea_presupuesto BASE (inmutabilidad del BASE).
 *  11. Aprobar actualiza ejecucion_partida.presupuesto_adicional_oc (handler síncrono).
 *  12. Rechazar OC (ENVIADO_CLIENTE → RECHAZADO con razon_rechazo).
 *  13. Anular OC (BORRADOR | ENVIADO_CLIENTE → ANULADO).
 *  14. Regla de Oro: avance en partida sin presupuesto BASE → ALERTA_TRABAJO_SIN_PRESUPUESTO.
 *  15. Avance en partida CON línea BASE → NO genera ALERTA_TRABAJO_SIN_PRESUPUESTO.
 *  16. Avance ≤ cantidad BASE → no genera ALERTA_AVANCE_EXCESO.
 *  17. Avance > cantidad BASE + cantidadAdicionalOc → ALERTA_AVANCE_EXCESO.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import { OrdenCambioService } from '../orden-cambio.service.js';
import { OrdenCambioAprobadaHandler } from '../handlers/orden-cambio-aprobada.handler.js';
import { ObraAvancePartidaHandler } from '../../obra/handlers/obra-avance-partida.handler.js';
import { DbService } from '../../database/db.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { ProjectionEngineService } from '../../ledger/projection-engine.service.js';

// ─── Conexiones ───────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';
const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

describe('Órdenes de Cambio — flujo completo + Regla de Oro', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  // ── Fixtures ─────────────────────────────────────────────────────────────
  let tenantId: string;
  let empresaId: string;
  let proyectoId: string;
  let clienteId: string;
  let unidadId: string;
  let partidaId: string;       // con línea en BASE — para tests 07-11, 15-17
  let partida2Id: string;      // SIN línea en BASE — para test 14 (Regla de Oro)
  let versionBaseId: string;

  // Servicios bajo prueba
  let ocSvc: OrdenCambioService;
  let handlerAvance: ObraAvancePartidaHandler;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool   = new Pool({ connectionString: APP_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantId   = newId();
    empresaId  = newId();
    proyectoId = newId();
    clienteId  = newId();
    unidadId   = newId();
    partidaId  = newId();
    partida2Id = newId();
    versionBaseId = newId();

    const uid = SYSTEM_USER_ID;
    const now = new Date();

    // Tenant
    await adminDb.insert(schema.tenants).values([{
      id: tenantId, nombre: 'T-OC', slug: `oc-t1-${tenantId.slice(-12)}`,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Empresa
    await adminDb.insert(schema.empresas).values([{
      id: empresaId, tenantId, nombre: 'Empresa OC Test',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Cliente
    await adminDb.insert(schema.terceros).values([{
      id: clienteId, tenantId, tipoIdentificacion: 'RNC',
      rncCedula: '101000099', nombreComercial: 'Cliente OC Test',
      tipoContribuyente: 'PERSONA_JURIDICA', condicionDgii: 'NORMAL',
      esCliente: true, esProveedor: false,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Proyecto
    await adminDb.insert(schema.proyectos).values([{
      id: proyectoId, tenantId, empresaId, clienteId,
      nombre: 'Proyecto OC', codigo: 'PROCT1',
      estado: 'EN_EJECUCION', monedaContrato: 'DOP',
      montoContrato: '5000000.0000',
      tipoObra: 'OTRO',
      presupuestoVigenteMonto: '0.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Unidad de medida
    await adminDb.insert(schema.unidadesMedida).values([{
      id: unidadId, tenantId, codigo: 'M3OC', nombre: 'Metro cúbico OC',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Partida 1 (con presupuesto BASE)
    await adminDb.insert(schema.partidas).values([{
      id: partidaId, tenantId, proyectoId, nivel: 2, orden: 1,
      numeroJerarquico: '1.1', codigo: 'PAR-OC-001', nombre: 'Hormigón OC',
      unidadMedidaId: unidadId,
      cantidadPresupuestada: '100.0000',
      precioUnitario: '50000.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Partida 2 (SIN presupuesto BASE — Regla de Oro)
    await adminDb.insert(schema.partidas).values([{
      id: partida2Id, tenantId, proyectoId, nivel: 2, orden: 2,
      numeroJerarquico: '1.2', codigo: 'PAR-OC-002', nombre: 'Trabajo Extra',
      unidadMedidaId: unidadId,
      cantidadPresupuestada: '50.0000',
      precioUnitario: '30000.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Versión de presupuesto BASE — crear como PENDIENTE para poder insertar líneas
    // (protect_lineas_aprobadas impide INSERT cuando estado=APROBADO)
    await adminDb.insert(schema.versionesPresupuesto).values([{
      id: versionBaseId, tenantId, proyectoId,
      nombre: 'Presupuesto Base OC', tipo: 'BASE', estado: 'PENDIENTE',
      moneda: 'DOP',
      totalDirecto: '5000000.0000',
      totalIndirecto: '0.0000',
      totalPresupuesto: '5000000.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Línea BASE solo para partida 1 (partida2 queda sin línea — Regla de Oro)
    await adminDb.insert(schema.lineasPresupuesto).values([{
      id: newId(), tenantId,
      versionPresupuestoId: versionBaseId,
      partidaId,
      cantidad: '100.0000',
      precioUnitario: '50000.0000',
      total: '5000000.0000',
      moneda: 'DOP',
      esIndirecto: false,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Ahora aprobar la versión (trigger protect_lineas_aprobadas solo afecta lineas, no la versión)
    await adminPool.query(
      `UPDATE version_presupuesto SET estado = 'APROBADO', aprobado_por = $1, aprobado_en = now(),
       updated_at = now(), updated_by = $1 WHERE id = $2`,
      [uid, versionBaseId],
    );

    // ── Servicios ────────────────────────────────────────────────────────────
    const dbSvc = { tx: adminDb } as unknown as DbService;

    const ocHandler = new OrdenCambioAprobadaHandler();
    handlerAvance   = new ObraAvancePartidaHandler();

    const projEngine = new ProjectionEngineService(
      [ocHandler, handlerAvance],
      dbSvc,
    );
    const ledgerSvc = new LedgerService(dbSvc, projEngine);
    ocSvc = new OrdenCambioService(dbSvc, ledgerSvc);
  });

  afterAll(async () => {
    await adminPool.query(`
      ALTER TABLE partida            DISABLE TRIGGER no_delete_partida;
      ALTER TABLE proyecto           DISABLE TRIGGER no_delete_proyecto;
      ALTER TABLE empresa            DISABLE TRIGGER no_delete_empresa;
      ALTER TABLE tenant             DISABLE TRIGGER no_delete_tenant;
      ALTER TABLE version_presupuesto DISABLE TRIGGER no_delete_version_presupuesto;
      ALTER TABLE linea_presupuesto  DISABLE TRIGGER protect_lineas_aprobadas;
    `);

    await adminPool.query(`DELETE FROM outbox            WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM ejecucion_partida WHERE tenant_id = $1`, [tenantId]);
    // NULL out FK antes de borrar evento_operativo (orden_cambio.evento_id → evento_operativo.id)
    await adminPool.query(`UPDATE orden_cambio SET evento_id = NULL WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM linea_orden_cambio  WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM orden_cambio        WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM linea_presupuesto   WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM version_presupuesto WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM partida      WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM unidad_medida WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM proyecto      WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM tercero       WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM empresa       WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM audit_log     WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM tenant        WHERE id = $1`, [tenantId]);

    await adminPool.query(`
      ALTER TABLE partida            ENABLE TRIGGER no_delete_partida;
      ALTER TABLE proyecto           ENABLE TRIGGER no_delete_proyecto;
      ALTER TABLE empresa            ENABLE TRIGGER no_delete_empresa;
      ALTER TABLE tenant             ENABLE TRIGGER no_delete_tenant;
      ALTER TABLE version_presupuesto ENABLE TRIGGER no_delete_version_presupuesto;
      ALTER TABLE linea_presupuesto  ENABLE TRIGGER protect_lineas_aprobadas;
    `);

    await adminPool.end();
    await appPool.end();
  });

  // ── TEST 01: Crear OC en BORRADOR ─────────────────────────────────────────
  it('01. Crear OC en BORRADOR con número secuencial por proyecto', async () => {
    const oc = await ocSvc.crear(
      tenantId,
      { empresaId, proyectoId, causa: 'CLIENTE', descripcion: 'Muro adicional norte' },
      SYSTEM_USER_ID,
    );

    expect(oc.estado).toBe('BORRADOR');
    expect(oc.numero).toBe(1);
    expect(oc.causa).toBe('CLIENTE');
    expect(oc.proyectoId).toBe(proyectoId);
    expect(oc.montoEstimado).toBe('0.0000');
  });

  // ── TEST 02: Agregar línea — montoEstimado actualizado ────────────────────
  it('02. Agregar línea a OC BORRADOR — montoEstimado se actualiza', async () => {
    // Necesitamos el ID de la OC creada en 01
    const [oc] = await adminDb
      .select()
      .from(schema.ordenCambios)
      .where(and(eq(schema.ordenCambios.tenantId, tenantId), eq(schema.ordenCambios.numero, 1)));

    const linea = await ocSvc.agregarLinea(
      tenantId,
      oc!.id,
      {
        partidaId,
        descripcion: 'Hormigón adicional 20 m³',
        esPartidaNueva: false,
        cantidadAdicional: '20.0000',
        montoAdicional: '1000000.0000',
        tipoImpacto: 'COSTO',
      },
      SYSTEM_USER_ID,
    );

    expect(linea.montoAdicional).toBe('1000000.0000');
    expect(linea.cantidadAdicional).toBe('20.0000');

    // Verificar montoEstimado en OC
    const [ocActualizada] = await adminDb
      .select()
      .from(schema.ordenCambios)
      .where(eq(schema.ordenCambios.id, oc!.id));

    expect(ocActualizada!.montoEstimado).toBe('1000000.0000');
  });

  // ── TEST 03: Rechaza agregar línea si no BORRADOR ─────────────────────────
  it('03. Rechaza agregar línea si OC no está en BORRADOR', async () => {
    // Crear una OC y enviarla al cliente primero
    const oc2 = await ocSvc.crear(
      tenantId,
      { empresaId, proyectoId, causa: 'CAMPO', descripcion: 'OC en estado no BORRADOR' },
      SYSTEM_USER_ID,
    );

    await ocSvc.agregarLinea(
      tenantId, oc2.id,
      { descripcion: 'Línea test', montoAdicional: '100.0000', esPartidaNueva: true, tipoImpacto: 'COSTO' },
      SYSTEM_USER_ID,
    );
    await ocSvc.enviarAlCliente(tenantId, oc2.id, SYSTEM_USER_ID);

    await expect(
      ocSvc.agregarLinea(
        tenantId, oc2.id,
        { descripcion: 'Línea extra', montoAdicional: '50.0000', esPartidaNueva: true, tipoImpacto: 'COSTO' },
        SYSTEM_USER_ID,
      ),
    ).rejects.toThrow('No se pueden agregar líneas');
  });

  // ── TEST 04: Enviar al cliente ─────────────────────────────────────────────
  it('04. Enviar al cliente (BORRADOR → ENVIADO_CLIENTE)', async () => {
    const [oc] = await adminDb
      .select()
      .from(schema.ordenCambios)
      .where(and(eq(schema.ordenCambios.tenantId, tenantId), eq(schema.ordenCambios.numero, 1)));

    const updated = await ocSvc.enviarAlCliente(tenantId, oc!.id, SYSTEM_USER_ID);
    expect(updated.estado).toBe('ENVIADO_CLIENTE');
  });

  // ── TEST 05: Rechaza enviar si no hay líneas ──────────────────────────────
  it('05. Rechaza enviarAlCliente si no hay líneas', async () => {
    const ocVacia = await ocSvc.crear(
      tenantId,
      { empresaId, proyectoId, causa: 'DISENO', descripcion: 'OC vacía' },
      SYSTEM_USER_ID,
    );

    await expect(
      ocSvc.enviarAlCliente(tenantId, ocVacia.id, SYSTEM_USER_ID),
    ).rejects.toThrow('al menos una línea');
  });

  // ── TEST 06: Rechaza enviar si ya está en ENVIADO_CLIENTE ────────────────
  it('06. Rechaza enviarAlCliente si OC no está en BORRADOR', async () => {
    const [oc] = await adminDb
      .select()
      .from(schema.ordenCambios)
      .where(and(eq(schema.ordenCambios.tenantId, tenantId), eq(schema.ordenCambios.numero, 2)));

    // Ya está en ENVIADO_CLIENTE (enviada en test 03)
    await expect(
      ocSvc.enviarAlCliente(tenantId, oc!.id, SYSTEM_USER_ID),
    ).rejects.toThrow('ENVIADO_CLIENTE');
  });

  // ── TEST 07: Aprobar OC ───────────────────────────────────────────────────
  it('07. Aprobar OC (ENVIADO_CLIENTE → APROBADO, monto_aprobado guardado)', async () => {
    const [oc] = await adminDb
      .select()
      .from(schema.ordenCambios)
      .where(and(eq(schema.ordenCambios.tenantId, tenantId), eq(schema.ordenCambios.numero, 1)));

    const aprobada = await ocSvc.aprobar(
      tenantId,
      oc!.id,
      { montoAprobado: '1000000.0000' },
      SYSTEM_USER_ID,
    );

    expect(aprobada.estado).toBe('APROBADO');
    expect(aprobada.montoAprobado).toBe('1000000.0000');
    expect(aprobada.aprobadoPor).toBe(SYSTEM_USER_ID);
    expect(aprobada.eventoId).toBeTruthy();
  });

  // ── TEST 08: Aprobar actualiza presupuesto_vigente_monto ──────────────────
  it('08. Aprobar actualiza proyecto.presupuesto_vigente_monto', async () => {
    const [proyecto] = await adminDb
      .select({ presupuestoVigenteMonto: schema.proyectos.presupuestoVigenteMonto })
      .from(schema.proyectos)
      .where(eq(schema.proyectos.id, proyectoId));

    expect(proyecto!.presupuestoVigenteMonto).toBe('1000000.0000');
  });

  // ── TEST 09: Aprobar genera evento orden_cambio_aprobada ─────────────────
  it('09. Aprobar genera evento orden_cambio_aprobada en evento_operativo', async () => {
    const eventos = await adminPool.query(
      `SELECT * FROM evento_operativo WHERE tenant_id = $1 AND tipo_evento = 'orden_cambio_aprobada'`,
      [tenantId],
    );

    expect(eventos.rows.length).toBe(1);
    expect(eventos.rows[0].proyecto_id).toBe(proyectoId);
  });

  // ── TEST 10: Aprobar NO modifica linea_presupuesto BASE ───────────────────
  it('10. Aprobar NO modifica linea_presupuesto BASE (inmutabilidad del BASE)', async () => {
    const lineas = await adminPool.query(
      `SELECT * FROM linea_presupuesto WHERE version_presupuesto_id = $1`,
      [versionBaseId],
    );

    // Solo debe existir la línea original (insertada en beforeAll)
    expect(lineas.rows.length).toBe(1);
    expect(lineas.rows[0].total).toBe('5000000.0000');
  });

  // ── TEST 11: Aprobar actualiza ejecucion_partida (handler síncrono) ───────
  it('11. Aprobar actualiza ejecucion_partida.presupuesto_adicional_oc', async () => {
    const rows = await adminPool.query(
      `SELECT presupuesto_adicional_oc, cantidad_adicional_oc
       FROM ejecucion_partida WHERE tenant_id = $1 AND partida_id = $2`,
      [tenantId, partidaId],
    );

    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].presupuesto_adicional_oc).toBe('1000000.0000');
    expect(rows.rows[0].cantidad_adicional_oc).toBe('20.0000');
  });

  // ── TEST 12: Rechazar OC ──────────────────────────────────────────────────
  it('12. Rechazar OC (ENVIADO_CLIENTE → RECHAZADO con razon_rechazo)', async () => {
    const [oc] = await adminDb
      .select()
      .from(schema.ordenCambios)
      .where(and(eq(schema.ordenCambios.tenantId, tenantId), eq(schema.ordenCambios.numero, 2)));

    const rechazada = await ocSvc.rechazar(
      tenantId,
      oc!.id,
      { razonRechazo: 'Fuera de alcance del contrato' },
      SYSTEM_USER_ID,
    );

    expect(rechazada.estado).toBe('RECHAZADO');
    expect(rechazada.razonRechazo).toBe('Fuera de alcance del contrato');
  });

  // ── TEST 13: Anular OC ────────────────────────────────────────────────────
  it('13. Anular OC (BORRADOR → ANULADO)', async () => {
    const ocAAnular = await ocSvc.crear(
      tenantId,
      { empresaId, proyectoId, causa: 'IMPREVISTO', descripcion: 'OC a anular' },
      SYSTEM_USER_ID,
    );

    const anulada = await ocSvc.anular(tenantId, ocAAnular.id, SYSTEM_USER_ID);
    expect(anulada.estado).toBe('ANULADO');
  });

  // ── TEST 14: Regla de Oro — ALERTA_TRABAJO_SIN_PRESUPUESTO ───────────────
  it('14. Regla de Oro: avance en partida sin presupuesto BASE → ALERTA_TRABAJO_SIN_PRESUPUESTO', async () => {
    const eventoId = newId();
    const idempKey  = newId();

    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'avance_partida',$5,$6::jsonb,$7,$8)`,
      [eventoId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID,
       JSON.stringify({
         parteDiarioId: newId(), avanceObraId: newId(),
         proyectoId, partidaId: partida2Id,
         cantidadEjecutada: '10.0000', unidad: 'm3', cantidadPresupuestada: '50.0000',
       }),
       idempKey, SYSTEM_USER_ID],
    );

    const evento = {
      id: eventoId, tenantId, empresaId, proyectoId, centroCostoId: null,
      tipoEvento: 'avance_partida', ocurridoEn: new Date(),
      usuarioId: SYSTEM_USER_ID,
      payload: {
        parteDiarioId: newId(), avanceObraId: newId(),
        proyectoId, partidaId: partida2Id,
        cantidadEjecutada: '10.0000', unidad: 'm3', cantidadPresupuestada: '50.0000',
      },
      idempotencyKey: idempKey, estado: 'registrado',
      createdAt: new Date(), createdBy: SYSTEM_USER_ID,
      referenciaId: null, referenciaTabla: null, reversadoPor: null,
    };

    await handlerAvance.ejecutar({ evento: evento as never, tx: adminDb as never });

    const alertas = await adminPool.query(
      `SELECT * FROM outbox WHERE tenant_id = $1 AND handler_nombre = 'ALERTA_TRABAJO_SIN_PRESUPUESTO' AND evento_id = $2`,
      [tenantId, eventoId],
    );

    expect(alertas.rows.length).toBe(1);
    expect((alertas.rows[0].payload as { tipo: string }).tipo).toBe('ALERTA_TRABAJO_SIN_PRESUPUESTO');
  });

  // ── TEST 15: Avance CON línea BASE → NO genera alerta de sin presupuesto ──
  it('15. Avance en partida CON línea BASE → NO genera ALERTA_TRABAJO_SIN_PRESUPUESTO', async () => {
    const eventoId = newId();
    const idempKey  = newId();

    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'avance_partida',$5,$6::jsonb,$7,$8)`,
      [eventoId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID,
       JSON.stringify({
         parteDiarioId: newId(), avanceObraId: newId(),
         proyectoId, partidaId,
         cantidadEjecutada: '5.0000', unidad: 'm3', cantidadPresupuestada: '100.0000',
       }),
       idempKey, SYSTEM_USER_ID],
    );

    const evento = {
      id: eventoId, tenantId, empresaId, proyectoId, centroCostoId: null,
      tipoEvento: 'avance_partida', ocurridoEn: new Date(),
      usuarioId: SYSTEM_USER_ID,
      payload: {
        parteDiarioId: newId(), avanceObraId: newId(),
        proyectoId, partidaId,
        cantidadEjecutada: '5.0000', unidad: 'm3', cantidadPresupuestada: '100.0000',
      },
      idempotencyKey: idempKey, estado: 'registrado',
      createdAt: new Date(), createdBy: SYSTEM_USER_ID,
      referenciaId: null, referenciaTabla: null, reversadoPor: null,
    };

    await handlerAvance.ejecutar({ evento: evento as never, tx: adminDb as never });

    const alertas = await adminPool.query(
      `SELECT * FROM outbox WHERE tenant_id = $1 AND handler_nombre = 'ALERTA_TRABAJO_SIN_PRESUPUESTO' AND evento_id = $2`,
      [tenantId, eventoId],
    );

    expect(alertas.rows.length).toBe(0);
  });

  // ── TEST 16: Avance ≤ cantidad vigente → sin ALERTA_AVANCE_EXCESO ─────────
  it('16. Avance ≤ cantidad BASE + OC delta → no genera ALERTA_AVANCE_EXCESO', async () => {
    // Después del test 11: ejecucion_partida tiene cantidadAdicionalOc = 20, avanceCantidad = 5 (test 15)
    // Cantidad vigente = 100 (BASE) + 20 (OC) = 120
    // Avance actual = 5, agregar 50 más = 55 → NO supera 120
    const eventoId = newId();
    const idempKey  = newId();

    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'avance_partida',$5,$6::jsonb,$7,$8)`,
      [eventoId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID,
       JSON.stringify({
         parteDiarioId: newId(), avanceObraId: newId(),
         proyectoId, partidaId,
         cantidadEjecutada: '50.0000', unidad: 'm3', cantidadPresupuestada: '100.0000',
       }),
       idempKey, SYSTEM_USER_ID],
    );

    const evento = {
      id: eventoId, tenantId, empresaId, proyectoId, centroCostoId: null,
      tipoEvento: 'avance_partida', ocurridoEn: new Date(),
      usuarioId: SYSTEM_USER_ID,
      payload: {
        parteDiarioId: newId(), avanceObraId: newId(),
        proyectoId, partidaId,
        cantidadEjecutada: '50.0000', unidad: 'm3', cantidadPresupuestada: '100.0000',
      },
      idempotencyKey: idempKey, estado: 'registrado',
      createdAt: new Date(), createdBy: SYSTEM_USER_ID,
      referenciaId: null, referenciaTabla: null, reversadoPor: null,
    };

    await handlerAvance.ejecutar({ evento: evento as never, tx: adminDb as never });

    const alertas = await adminPool.query(
      `SELECT * FROM outbox WHERE tenant_id = $1 AND handler_nombre = 'ALERTA_AVANCE_EXCESO' AND evento_id = $2`,
      [tenantId, eventoId],
    );

    expect(alertas.rows.length).toBe(0);
  });

  // ── TEST 17: Avance > vigente (BASE + OC) → ALERTA_AVANCE_EXCESO ─────────
  it('17. Avance > cantidad BASE + cantidadAdicionalOc → ALERTA_AVANCE_EXCESO', async () => {
    // Avance acumulado actual: 5 + 50 = 55 m³, vigente = 120
    // Agregar 70 más → acumulado = 125 → supera 120 → alerta
    const eventoId = newId();
    const idempKey  = newId();

    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'avance_partida',$5,$6::jsonb,$7,$8)`,
      [eventoId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID,
       JSON.stringify({
         parteDiarioId: newId(), avanceObraId: newId(),
         proyectoId, partidaId,
         cantidadEjecutada: '70.0000', unidad: 'm3', cantidadPresupuestada: '100.0000',
       }),
       idempKey, SYSTEM_USER_ID],
    );

    const evento = {
      id: eventoId, tenantId, empresaId, proyectoId, centroCostoId: null,
      tipoEvento: 'avance_partida', ocurridoEn: new Date(),
      usuarioId: SYSTEM_USER_ID,
      payload: {
        parteDiarioId: newId(), avanceObraId: newId(),
        proyectoId, partidaId,
        cantidadEjecutada: '70.0000', unidad: 'm3', cantidadPresupuestada: '100.0000',
      },
      idempotencyKey: idempKey, estado: 'registrado',
      createdAt: new Date(), createdBy: SYSTEM_USER_ID,
      referenciaId: null, referenciaTabla: null, reversadoPor: null,
    };

    await handlerAvance.ejecutar({ evento: evento as never, tx: adminDb as never });

    const alertas = await adminPool.query(
      `SELECT * FROM outbox WHERE tenant_id = $1 AND handler_nombre = 'ALERTA_AVANCE_EXCESO' AND evento_id = $2`,
      [tenantId, eventoId],
    );

    expect(alertas.rows.length).toBe(1);
    expect((alertas.rows[0].payload as { tipo: string }).tipo).toBe('ALERTA_AVANCE_EXCESO');
  });
});
