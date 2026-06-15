/**
 * PRUEBAS DE INTEGRACIÓN — Tablero de Control + Valor Ganado (Sesión 9 Capa 1)
 *
 *  01. tableroPartidas retorna todas las partidas del proyecto.
 *  02. presupuesto_vigente = linea_base.total + ep.presupuesto_adicional_oc.
 *  03. comprometido refleja ep.comprometido.
 *  04. devengado refleja ep.devengado.
 *  05. Tríada reconciliada: comprometido + devengado + disponible = presupuesto_vigente.
 *  06. pagado refleja ep.pagado (desde seed directo).
 *  07. CPI = EV / AC cuando AC > 0.
 *  08. SPI = EV / PV.
 *  09. CPI es null cuando AC = 0 (sin costo real).
 *  10. Alerta VERDE: CPI ≥ 0.90 y disponible ≥ 10 % del vigente.
 *  11. Alerta AMARILLO: CPI ∈ [0.75, 0.90).
 *  12. Alerta ROJO: CPI < 0.75.
 *  13. Alerta ROJO: disponible < 0 (sobre-gasto en comprometido + devengado).
 *  14. PagoEjecucionPartidaHandler distribuye pago proporcionalmente a partida.
 *  15. tableroProyecto muestra pagado actualizado tras el evento de pago.
 *  16. tableroProyecto: CPI del proyecto = sumEV / sumAC de todas las partidas.
 *  17. curvaS retorna series EV y AC acumuladas; trazabilidadPartida lista eventos.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import Decimal from 'decimal.js';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import { TableroService } from '../tablero.service.js';
import { PagoEjecucionPartidaHandler } from '../handlers/pago-ejecucion-partida.handler.js';
import { DbService } from '../../database/db.service.js';
import type { EventoOperativoSelect } from '../../db/schema/ledger/evento_operativo.js';

// ─── Conexiones ───────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

describe('Tablero de Control + Valor Ganado', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  // ── Fixtures core ────────────────────────────────────────────────────────────
  let tenantId: string;
  let empresaId: string;
  let clienteId: string;
  let proveedorId: string;
  let proyectoId: string;
  let unidadId: string;
  let almacenId: string;
  let insumoId: string;

  // 4 partidas con escenarios distintos de alerta
  let p1Id: string; // VERDE
  let p2Id: string; // AMARILLO  (CPI ∈ [0.75, 0.90))
  let p3Id: string; // ROJO-CPI  (CPI < 0.75)
  let p4Id: string; // ROJO-disp (disponible < 0)

  let versionBaseId: string;

  // PagoEjecucion chain
  let ocId: string;
  let lineaOcId: string;
  let recepcionOcId: string;
  let lineaRecepcionOcId: string;
  let eventoOrigenCxpId: string;
  let facturaId: string;
  let cxpId: string;

  // Trazabilidad + CurvaS
  let eventoAvanceId: string;
  let parteDiarioId: string;

  // Servicios bajo prueba
  let svc: TableroService;
  let pagoHandler: PagoEjecucionPartidaHandler;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb   = drizzle(adminPool, { schema });

    const uid = SYSTEM_USER_ID;
    const now = new Date();

    tenantId    = newId();
    empresaId   = newId();
    clienteId   = newId();
    proveedorId = newId();
    proyectoId  = newId();
    unidadId    = newId();
    almacenId   = newId();
    insumoId    = newId();
    p1Id = newId();
    p2Id = newId();
    p3Id = newId();
    p4Id = newId();
    versionBaseId = newId();

    ocId              = newId();
    lineaOcId         = newId();
    recepcionOcId     = newId();
    lineaRecepcionOcId = newId();
    eventoOrigenCxpId = newId();
    facturaId         = newId();
    cxpId             = newId();

    eventoAvanceId = newId();
    parteDiarioId  = newId();

    // ── Tenant + Empresa ─────────────────────────────────────────────────────
    await adminDb.insert(schema.tenants).values([{
      id: tenantId, nombre: 'T-Tablero', slug: `tbl-${tenantId.slice(-12)}`,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.empresas).values([{
      id: empresaId, tenantId, nombre: 'Constructora Tablero S.A.',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Terceros: cliente + proveedor ────────────────────────────────────────
    await adminDb.insert(schema.terceros).values([
      {
        id: clienteId, tenantId, tipoIdentificacion: 'RNC',
        rncCedula: '101000199', nombreComercial: 'Cliente Tablero',
        tipoContribuyente: 'PERSONA_JURIDICA', condicionDgii: 'NORMAL',
        esCliente: true, esProveedor: false,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: proveedorId, tenantId, tipoIdentificacion: 'RNC',
        rncCedula: '101000299', nombreComercial: 'Proveedor Tablero',
        tipoContribuyente: 'PERSONA_JURIDICA', condicionDgii: 'NORMAL',
        esCliente: false, esProveedor: true,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // ── Proyecto ─────────────────────────────────────────────────────────────
    await adminDb.insert(schema.proyectos).values([{
      id: proyectoId, tenantId, empresaId, clienteId,
      nombre: 'Proyecto Tablero', codigo: 'TBL-001',
      estado: 'EN_EJECUCION', monedaContrato: 'DOP',
      montoContrato: '10000000.0000',
      tipoObra: 'OTRO',
      presupuestoVigenteMonto: '0.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Catálogos ─────────────────────────────────────────────────────────────
    await adminDb.insert(schema.unidadesMedida).values([{
      id: unidadId, tenantId, codigo: 'M3TBL', nombre: 'Metro cúbico Tablero',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.almacenes).values([{
      id: almacenId, tenantId, empresaId,
      tipo: 'OBRA', codigo: 'ALM-TBL', nombre: 'Almacén Tablero',
      activo: true,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.insumos).values([{
      id: insumoId, tenantId, codigo: 'INS-TBL', nombre: 'Cemento Tablero',
      unidadId, categoria: 'MATERIAL', activo: true,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── 4 Partidas ────────────────────────────────────────────────────────────
    await adminDb.insert(schema.partidas).values([
      {
        id: p1Id, tenantId, proyectoId, nivel: 2, orden: 1,
        numeroJerarquico: '1.1', codigo: 'TBL-P1', nombre: 'Hormigón (VERDE)',
        unidadMedidaId: unidadId, cantidadPresupuestada: '100.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: p2Id, tenantId, proyectoId, nivel: 2, orden: 2,
        numeroJerarquico: '1.2', codigo: 'TBL-P2', nombre: 'Excavación (AMARILLO)',
        unidadMedidaId: unidadId, cantidadPresupuestada: '50.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: p3Id, tenantId, proyectoId, nivel: 2, orden: 3,
        numeroJerarquico: '1.3', codigo: 'TBL-P3', nombre: 'Acero (ROJO-CPI)',
        unidadMedidaId: unidadId, cantidadPresupuestada: '40.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: p4Id, tenantId, proyectoId, nivel: 2, orden: 4,
        numeroJerarquico: '1.4', codigo: 'TBL-P4', nombre: 'Carpintería (ROJO-disp)',
        unidadMedidaId: unidadId, cantidadPresupuestada: '30.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // ── Versión presupuesto BASE (crear como PENDIENTE, aprobar después) ──────
    await adminDb.insert(schema.versionesPresupuesto).values([{
      id: versionBaseId, tenantId, proyectoId,
      nombre: 'Presupuesto Base Tablero', tipo: 'BASE', estado: 'PENDIENTE',
      moneda: 'DOP',
      totalDirecto: '2200000.0000',
      totalIndirecto: '0.0000',
      totalPresupuesto: '2200000.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // 4 líneas BASE:
    //   p1: total=1,000,000  qty=100  → unit=10,000
    //   p2: total=  500,000  qty= 50  → unit=10,000
    //   p3: total=  400,000  qty= 40  → unit=10,000
    //   p4: total=  300,000  qty= 30  → unit=10,000
    await adminDb.insert(schema.lineasPresupuesto).values([
      {
        id: newId(), tenantId, versionPresupuestoId: versionBaseId,
        partidaId: p1Id, cantidad: '100.0000', precioUnitario: '10000.0000',
        total: '1000000.0000', moneda: 'DOP', esIndirecto: false,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: newId(), tenantId, versionPresupuestoId: versionBaseId,
        partidaId: p2Id, cantidad: '50.0000', precioUnitario: '10000.0000',
        total: '500000.0000', moneda: 'DOP', esIndirecto: false,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: newId(), tenantId, versionPresupuestoId: versionBaseId,
        partidaId: p3Id, cantidad: '40.0000', precioUnitario: '10000.0000',
        total: '400000.0000', moneda: 'DOP', esIndirecto: false,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: newId(), tenantId, versionPresupuestoId: versionBaseId,
        partidaId: p4Id, cantidad: '30.0000', precioUnitario: '10000.0000',
        total: '300000.0000', moneda: 'DOP', esIndirecto: false,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // Aprobar la versión BASE
    await adminPool.query(
      `UPDATE version_presupuesto SET estado = 'APROBADO', aprobado_por = $1, aprobado_en = now(),
       updated_at = now(), updated_by = $1 WHERE id = $2`,
      [uid, versionBaseId],
    );

    // ── ejecucion_partida (seed directo con valores conocidos) ────────────────
    // p1 VERDE:  comp=100K dev=150K pag=50K avance=40  → EV=400K AC=150K CPI=2.667
    // p2 AMRL:   comp=  0  dev=240K pag= 0  avance=20  → EV=200K AC=240K CPI=0.833
    // p3 ROJO-C: comp=  0  dev=280K pag= 0  avance=15  → EV=150K AC=280K CPI=0.536
    // p4 ROJO-D: comp=200K dev=150K pag= 0  avance=25  → disp=-50K (negativo)
    await adminDb.insert(schema.ejecucionPartidas).values([
      {
        id: newId(), tenantId, partidaId: p1Id,
        comprometido: '100000.0000', devengado: '150000.0000',
        pagado: '50000.0000', avanceCantidad: '40.0000',
        presupuestoAdicionalOc: '0.0000', cantidadAdicionalOc: '0.0000',
        moneda: 'DOP', ultimaActualizacion: now,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: newId(), tenantId, partidaId: p2Id,
        comprometido: '0.0000', devengado: '240000.0000',
        pagado: '0.0000', avanceCantidad: '20.0000',
        presupuestoAdicionalOc: '0.0000', cantidadAdicionalOc: '0.0000',
        moneda: 'DOP', ultimaActualizacion: now,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: newId(), tenantId, partidaId: p3Id,
        comprometido: '0.0000', devengado: '280000.0000',
        pagado: '0.0000', avanceCantidad: '15.0000',
        presupuestoAdicionalOc: '0.0000', cantidadAdicionalOc: '0.0000',
        moneda: 'DOP', ultimaActualizacion: now,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: newId(), tenantId, partidaId: p4Id,
        comprometido: '200000.0000', devengado: '150000.0000',
        pagado: '0.0000', avanceCantidad: '25.0000',
        presupuestoAdicionalOc: '0.0000', cantidadAdicionalOc: '0.0000',
        moneda: 'DOP', ultimaActualizacion: now,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // ── PagoEjecucion chain ───────────────────────────────────────────────────
    // OC → lineaOC → RecepcionOC → LineaRecepcionOC → Factura → CxP

    await adminDb.insert(schema.ordenesCompra).values([{
      id: ocId, tenantId, empresaId, numero: 'OC-TBL-001',
      estado: 'RECIBIDA_TOTAL', terceroId: proveedorId,
      totalMonto: '200000.0000', moneda: 'DOP',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.lineasOrdenCompra).values([{
      id: lineaOcId, tenantId, ordenCompraId: ocId,
      partidaId: p1Id, descripcion: 'Cemento para tablero',
      cantidad: '10.0000', unidadMedida: 'SAC',
      precioUnitario: '20000.0000', total: '200000.0000', moneda: 'DOP',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.recepcionesOc).values([{
      id: recepcionOcId, tenantId, empresaId,
      ordenCompraId: ocId, numero: 'REC-TBL-001',
      fechaRecepcion: '2026-01-10', almacenId,
      estado: 'CONFIRMADA',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.lineasRecepcionOc).values([{
      id: lineaRecepcionOcId, tenantId,
      recepcionOcId, lineaOrdenCompraId: lineaOcId,
      insumoId, partidaId: p1Id,
      cantidadRecibida: '10.0000', costoUnitario: '20000.0000', moneda: 'DOP',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Evento origen de la CxP (recepcion_factura_proveedor)
    await adminDb.insert(schema.eventosOperativos).values([{
      id: eventoOrigenCxpId, tenantId, empresaId, proyectoId,
      tipoEvento: 'recepcion_factura_proveedor',
      usuarioId: uid, payload: { ncf: 'E310000000001', proveedorId, montoTotal: { amount: '200000.0000', currency: 'DOP' } },
      idempotencyKey: `evt-cxp-tbl-${tenantId}`,
      estado: 'registrado', createdAt: now, createdBy: uid,
    }]);

    await adminDb.insert(schema.facturasProveedor).values([{
      id: facturaId, tenantId, empresaId,
      terceroId: proveedorId, ordenCompraId: ocId, recepcionOcId,
      numero: 'FAC-TBL-001', ncf: 'E310000000001',
      fechaFactura: '2026-01-10',
      montoSubtotal: '200000.0000', montoItbis: '0.0000',
      montoTotal: '200000.0000', moneda: 'DOP',
      estadoMatch: 'OK', estadoCxp: 'PENDIENTE',
      ecfValidado: false,
      toleranciaPrecioPct: '2.00', toleranciaCantidadPct: '5.00',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.cuentasPorPagar).values([{
      id: cxpId, tenantId, empresaId,
      facturaProveedorId: facturaId, terceroId: proveedorId,
      montoOriginal: '200000.0000', montoPagado: '0.0000', moneda: 'DOP',
      estado: 'PENDIENTE', eventoOrigenId: eventoOrigenCxpId,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Trazabilidad + CurvaS (avance_obra + movimiento_inventario) ──────────
    const semana1 = new Date('2026-01-05T10:00:00Z');
    const semana2 = new Date('2026-01-12T10:00:00Z');

    // Evento avance (para trazabilidad)
    await adminDb.insert(schema.eventosOperativos).values([{
      id: eventoAvanceId, tenantId, empresaId, proyectoId,
      tipoEvento: 'avance_partida',
      usuarioId: uid,
      payload: { partidaId: p1Id, cantidadEjecutada: '20.0000', unidad: 'M3', idempotencyKey: `av1-${tenantId}` },
      idempotencyKey: `evt-avance-tbl-${tenantId}`,
      estado: 'registrado', createdAt: semana1, createdBy: uid,
    }]);

    // Parte diario
    await adminDb.insert(schema.partesDiario).values([{
      id: parteDiarioId, tenantId, empresaId, proyectoId,
      fecha: '2026-01-05', estado: 'CONFIRMADO',
      idempotencyKey: `pd-tbl-${tenantId}`,
      createdAt: semana1, createdBy: uid, updatedAt: semana1, updatedBy: uid,
    }]);

    // 2 avances en semanas distintas
    await adminDb.insert(schema.avancesObra).values([
      {
        id: newId(), tenantId, parteId: parteDiarioId,
        partidaId: p1Id, cantidadEjecutada: '20.0000', unidad: 'M3',
        eventoId: eventoAvanceId,
        idempotencyKey: `av-tbl-1-${tenantId}`,
        createdAt: semana1, createdBy: uid, updatedAt: semana1, updatedBy: uid,
      },
      {
        id: newId(), tenantId, parteId: parteDiarioId,
        partidaId: p1Id, cantidadEjecutada: '20.0000', unidad: 'M3',
        eventoId: eventoAvanceId,
        idempotencyKey: `av-tbl-2-${tenantId}`,
        createdAt: semana2, createdBy: uid, updatedAt: semana2, updatedBy: uid,
      },
    ]);

    // 2 movimientos SALIDA en semanas distintas (para AC curvaS)
    await adminDb.insert(schema.movimientosInventario).values([
      {
        id: newId(), tenantId, almacenId, insumoId,
        tipoMovimiento: 'SALIDA',
        cantidad: '5.0000', costoUnitario: '20000.0000', costoTotal: '100000.0000',
        moneda: 'DOP', eventoOperativoId: eventoOrigenCxpId,
        partidaId: p1Id,
        createdAt: semana1, createdBy: uid,
      },
      {
        id: newId(), tenantId, almacenId, insumoId,
        tipoMovimiento: 'SALIDA',
        cantidad: '4.0000', costoUnitario: '20000.0000', costoTotal: '80000.0000',
        moneda: 'DOP', eventoOperativoId: eventoOrigenCxpId,
        partidaId: p1Id,
        createdAt: semana2, createdBy: uid,
      },
    ]);

    // ── Servicios ─────────────────────────────────────────────────────────────
    const dbSvc      = { tx: adminDb } as unknown as DbService;
    svc              = new TableroService(dbSvc);
    pagoHandler      = new PagoEjecucionPartidaHandler();
  });

  afterAll(async () => {
    // Deshabilitar triggers que bloquean DELETE
    await adminPool.query(`
      ALTER TABLE partida             DISABLE TRIGGER no_delete_partida;
      ALTER TABLE proyecto            DISABLE TRIGGER no_delete_proyecto;
      ALTER TABLE empresa             DISABLE TRIGGER no_delete_empresa;
      ALTER TABLE tenant              DISABLE TRIGGER no_delete_tenant;
      ALTER TABLE version_presupuesto DISABLE TRIGGER no_delete_version_presupuesto;
      ALTER TABLE linea_presupuesto   DISABLE TRIGGER protect_lineas_aprobadas;
      ALTER TABLE cuenta_por_pagar    DISABLE TRIGGER no_delete_cuenta_por_pagar;
      ALTER TABLE factura_proveedor   DISABLE TRIGGER no_delete_factura_proveedor;
      ALTER TABLE recepcion_oc        DISABLE TRIGGER no_delete_recepcion_oc;
      ALTER TABLE orden_compra        DISABLE TRIGGER no_delete_orden_compra;
    `);

    // Eliminar en orden reverso de dependencias
    await adminPool.query(`DELETE FROM outbox                WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM movimiento_inventario WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM avance_obra           WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM parte_diario          WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM cuenta_por_pagar      WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`UPDATE factura_proveedor SET evento_id = NULL  WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM factura_proveedor     WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM linea_recepcion_oc    WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`UPDATE recepcion_oc SET evento_recepcion_id = NULL WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM recepcion_oc          WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM linea_orden_compra    WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM orden_compra          WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM ejecucion_partida     WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM linea_presupuesto     WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM version_presupuesto   WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM partida               WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM almacen          WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM insumo           WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM unidad_medida    WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM proyecto         WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM tercero          WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM empresa          WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM audit_log        WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM tenant           WHERE id        = $1`, [tenantId]);

    await adminPool.query(`
      ALTER TABLE partida             ENABLE TRIGGER no_delete_partida;
      ALTER TABLE proyecto            ENABLE TRIGGER no_delete_proyecto;
      ALTER TABLE empresa             ENABLE TRIGGER no_delete_empresa;
      ALTER TABLE tenant              ENABLE TRIGGER no_delete_tenant;
      ALTER TABLE version_presupuesto ENABLE TRIGGER no_delete_version_presupuesto;
      ALTER TABLE linea_presupuesto   ENABLE TRIGGER protect_lineas_aprobadas;
      ALTER TABLE cuenta_por_pagar    ENABLE TRIGGER no_delete_cuenta_por_pagar;
      ALTER TABLE factura_proveedor   ENABLE TRIGGER no_delete_factura_proveedor;
      ALTER TABLE recepcion_oc        ENABLE TRIGGER no_delete_recepcion_oc;
      ALTER TABLE orden_compra        ENABLE TRIGGER no_delete_orden_compra;
    `);

    await adminPool.end();
  });

  // ── Helper: buscar fila de tablero por partidaId ──────────────────────────
  async function getPartidaRow(partidaId: string) {
    const filas = await svc.tableroPartidas(tenantId, proyectoId);
    const fila = filas.find((f) => f.partidaId === partidaId);
    if (!fila) throw new Error(`Partida ${partidaId} no encontrada en tablero`);
    return fila;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TESTS 01-06: Tríada básica
  // ─────────────────────────────────────────────────────────────────────────────

  it('01. tableroPartidas retorna las 4 partidas del proyecto', async () => {
    const filas = await svc.tableroPartidas(tenantId, proyectoId);
    expect(filas).toHaveLength(4);
    const ids = filas.map((f) => f.partidaId);
    expect(ids).toContain(p1Id);
    expect(ids).toContain(p2Id);
    expect(ids).toContain(p3Id);
    expect(ids).toContain(p4Id);
  });

  it('02. presupuesto_vigente = linea_base.total + ep.presupuesto_adicional_oc', async () => {
    const f = await getPartidaRow(p1Id);
    // p1: BASE=1,000,000 + OC_delta=0 = 1,000,000
    expect(f.presupuestoVigente).toBe('1000000.0000');
  });

  it('03. comprometido refleja ep.comprometido', async () => {
    const f = await getPartidaRow(p1Id);
    expect(f.comprometido).toBe('100000.0000');
  });

  it('04. devengado refleja ep.devengado', async () => {
    const f = await getPartidaRow(p1Id);
    expect(f.devengado).toBe('150000.0000');
  });

  it('05. Tríada reconciliada: comprometido + devengado + disponible = presupuesto_vigente', async () => {
    const filas = await svc.tableroPartidas(tenantId, proyectoId);
    for (const f of filas) {
      const suma = new Decimal(f.comprometido)
        .plus(f.devengado)
        .plus(f.disponible);
      expect(suma.toFixed(4)).toBe(f.presupuestoVigente);
    }
  });

  it('06. pagado refleja ep.pagado (seed directo)', async () => {
    const f = await getPartidaRow(p1Id);
    expect(f.pagado).toBe('50000.0000');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TESTS 07-09: EVM indices
  // ─────────────────────────────────────────────────────────────────────────────

  it('07. CPI = EV / AC cuando AC > 0', async () => {
    // p1: EV = 1,000,000 × (40/100) = 400,000; AC = 150,000; CPI = 2.6667
    const f = await getPartidaRow(p1Id);
    expect(f.ev).toBe('400000.0000');
    expect(f.ac).toBe('150000.0000');
    const cpiEsperado = new Decimal('400000').div('150000').toFixed(4);
    expect(f.cpi).toBe(cpiEsperado);
  });

  it('08. SPI = EV / PV (EV dividido por presupuesto vigente)', async () => {
    // p1: EV=400,000 / PV=1,000,000 = 0.40
    const f = await getPartidaRow(p1Id);
    const spiEsperado = new Decimal('400000').div('1000000').toFixed(4);
    expect(f.spi).toBe(spiEsperado);
  });

  it('09. CPI es null cuando AC = 0 (partida sin costo real)', async () => {
    // Insertar partida temporal sin devengado
    const p5Id = newId();
    const uid = SYSTEM_USER_ID;
    const now = new Date();
    await adminDb.insert(schema.partidas).values([{
      id: p5Id, tenantId, proyectoId, nivel: 2, orden: 5,
      numeroJerarquico: '1.5', codigo: 'TBL-P5', nombre: 'Partida Sin Costo',
      unidadMedidaId: unidadId, cantidadPresupuestada: '10.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);
    // No ejecucion_partida para p5 → todos los valores son null/0 en left join

    try {
      const filas = await svc.tableroPartidas(tenantId, proyectoId);
      const f = filas.find((r) => r.partidaId === p5Id)!;
      expect(f).toBeDefined();
      expect(f.cpi).toBeNull(); // AC = 0 → CPI null
    } finally {
      // Limpiar p5
      await adminPool.query(`ALTER TABLE partida DISABLE TRIGGER no_delete_partida`);
      await adminPool.query(`DELETE FROM partida WHERE id = $1`, [p5Id]);
      await adminPool.query(`ALTER TABLE partida ENABLE TRIGGER no_delete_partida`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TESTS 10-13: Alertas de umbral
  // ─────────────────────────────────────────────────────────────────────────────

  it('10. Alerta VERDE: CPI ≥ 0.90 y disponible ≥ 10 % del vigente', async () => {
    // p1: CPI=2.667 ≥ 0.90; disp=750K = 75% del vigente ≥ 10%
    const f = await getPartidaRow(p1Id);
    expect(f.alerta).toBe('VERDE');
  });

  it('11. Alerta AMARILLO: CPI ∈ [0.75, 0.90)', async () => {
    // p2: CPI=200K/240K=0.833 → AMARILLO
    const f = await getPartidaRow(p2Id);
    const cpi = parseFloat(f.cpi!);
    expect(cpi).toBeGreaterThanOrEqual(0.75);
    expect(cpi).toBeLessThan(0.90);
    expect(f.alerta).toBe('AMARILLO');
  });

  it('12. Alerta ROJO: CPI < 0.75', async () => {
    // p3: CPI=150K/280K=0.536 → ROJO
    const f = await getPartidaRow(p3Id);
    const cpi = parseFloat(f.cpi!);
    expect(cpi).toBeLessThan(0.75);
    expect(f.alerta).toBe('ROJO');
  });

  it('13. Alerta ROJO: disponible < 0 (sobre-gasto)', async () => {
    // p4: comp=200K dev=150K vigente=300K → disp=-50K < 0 → ROJO
    const f = await getPartidaRow(p4Id);
    const disp = parseFloat(f.disponible);
    expect(disp).toBeLessThan(0);
    expect(f.alerta).toBe('ROJO');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TESTS 14-15: PagoEjecucionPartidaHandler
  // ─────────────────────────────────────────────────────────────────────────────

  it('14. PagoEjecucionPartidaHandler distribuye el pago a ejecucion_partida.pagado', async () => {
    const eventoFake = {
      id: newId(),
      tenantId,
      empresaId,
      proyectoId,
      centroCostoId: null,
      tipoEvento: 'pago_emitido',
      ocurridoEn: new Date(),
      usuarioId: SYSTEM_USER_ID,
      payload: {
        cuentaBancariaId: newId(),
        monto: { amount: '200000.0000', currency: 'DOP' },
        concepto: 'Pago cemento tablero',
        cuentasPorPagarIds: [cxpId],
        referenciaBancaria: null,
      },
      partidaId: null,
      referenciaId: null,
      referenciaTabla: null,
      idempotencyKey: `pago-tbl-${tenantId}`,
      estado: 'registrado',
      eventoReversaId: null,
      createdAt: new Date(),
      createdBy: SYSTEM_USER_ID,
    } as unknown as EventoOperativoSelect;

    await pagoHandler.ejecutar({ evento: eventoFake, tx: adminDb });

    // ep.pagado de p1 debe haber aumentado en 200,000 (era 50,000 en seed → ahora 250,000)
    const [ep] = await adminDb
      .select({ pagado: schema.ejecucionPartidas.pagado })
      .from(schema.ejecucionPartidas)
      .where(
        and(
          eq(schema.ejecucionPartidas.tenantId, tenantId),
          eq(schema.ejecucionPartidas.partidaId, p1Id),
        ),
      )
      .limit(1);

    expect(ep!.pagado).toBe('250000.0000');
  });

  it('15. tableroProyecto muestra pagado actualizado tras el evento de pago', async () => {
    const tablero = await svc.tableroProyecto(tenantId, proyectoId);
    const f = tablero.partidas.find((r) => r.partidaId === p1Id)!;
    expect(f.pagado).toBe('250000.0000');

    // El total del proyecto incluye el pagado actualizado de p1
    const pagadoTotal = new Decimal(tablero.pagado);
    // p1=250K + p2=0 + p3=0 + p4=0 = 250,000
    expect(pagadoTotal.toFixed(4)).toBe('250000.0000');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 16: tableroProyecto — agregados y CPI del proyecto
  // ─────────────────────────────────────────────────────────────────────────────

  it('16. tableroProyecto: CPI del proyecto = sumEV / sumAC de todas las partidas', async () => {
    const tablero = await svc.tableroProyecto(tenantId, proyectoId);

    // presupuesto vigente total = 1M + 500K + 400K + 300K = 2,200,000
    expect(tablero.presupuestoVigente).toBe('2200000.0000');

    // sumEV = 400K + 200K + 150K + 250K = 1,000,000
    expect(tablero.ev).toBe('1000000.0000');

    // sumAC = 150K + 240K + 280K + 150K = 820,000
    expect(tablero.ac).toBe('820000.0000');

    // CPI del proyecto = 1,000,000 / 820,000
    const cpiEsperado = new Decimal('1000000').div('820000').toFixed(4);
    expect(tablero.cpi).toBe(cpiEsperado);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 17: CurvaS + Trazabilidad
  // ─────────────────────────────────────────────────────────────────────────────

  it('17. curvaS retorna puntos EV+AC acumulados; trazabilidadPartida lista el evento de avance', async () => {
    // ── CurvaS ──────────────────────────────────────────────────────────────
    const curva = await svc.curvaS(tenantId, proyectoId);

    // Debe haber al menos 2 puntos (semana de ene-5 y ene-12)
    expect(curva.length).toBeGreaterThanOrEqual(2);

    // EV semana 1: 20 avance × (1,000,000 / 100) = 200,000
    // EV semana 2: 20 × 10,000 = 200,000 → acumulado = 400,000
    const ultimo = curva[curva.length - 1]!;
    expect(new Decimal(ultimo.evAcumulado).gte(new Decimal('200000'))).toBe(true);

    // AC semana 1: 100,000 → AC semana 2: 80,000 → acumulado = 180,000
    expect(new Decimal(ultimo.acAcumulado).gte(new Decimal('80000'))).toBe(true);

    // Los puntos deben ser cronológicos
    for (let i = 1; i < curva.length; i++) {
      expect(curva[i]!.semana >= curva[i - 1]!.semana).toBe(true);
    }

    // ── Trazabilidad ──────────────────────────────────────────────────────────
    const traza = await svc.trazabilidadPartida(tenantId, p1Id);

    // El evento de avance debe aparecer (avance_obra.evento_id = eventoAvanceId)
    const encontrado = traza.some((t) => t.eventoId === eventoAvanceId);
    expect(encontrado).toBe(true);

    // El tipo de evento debe ser avance_partida
    const ev = traza.find((t) => t.eventoId === eventoAvanceId)!;
    expect(ev.tipoEvento).toBe('avance_partida');
  });
});
