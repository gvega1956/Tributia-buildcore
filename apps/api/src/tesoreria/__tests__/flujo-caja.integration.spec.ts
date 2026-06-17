/**
 * PRUEBAS DE INTEGRACIÓN — Flujo de Caja Proyectado por Proyecto (Sesión 6 Capa 2, §16)
 *
 *  01. Semana 3: CxC de 100.000 → totalInflows correcto, totalOutflows = 0.
 *  02. Semana 1: OC grande sin cobros previos → alertaDeficit = true.
 *  03. CxC PAGADA_PARCIAL: el monto proyectado es monto_original − monto_cobrado.
 *  04. Cubicación proyectada sin vincular → aparece como CXC_PROYECTADA en s4.
 *  05. Cubicación proyectada con cubicacion_id → NO aparece en ningún inflow.
 *  06. OC EMITIDA (por partida del proyecto) → aparece como OC_COMPROMETIDA en s1.
 *  07. Consolidado: saldo inicial = saldo de cuentas bancarias DOP activas.
 *  08. Programación de pago PROGRAMADO → PAGO_PROGRAMADO en s2.
 *  09. Ítem con fecha en semana 14 (fuera del horizonte=13) → no aparece.
 *  10. Trazabilidad P8: cada ItemFlujo tiene referenciaId y referenciaTipo no vacíos.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import { DbService } from '../../database/db.service.js';
import { FlujoCajaService } from '../flujo-caja.service.js';

// ─── Conexión ─────────────────────────────────────────────────────────────────

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dateInWeek(weekN: number, dayOffset = 3): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(today.getTime() + (weekN - 1) * 7 * 86_400_000 + dayOffset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

describe('Flujo de Caja Proyectado — integración (Sesión 6 Capa 2)', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  // ── IDs de fixtures ───────────────────────────────────────────────────────
  let tenantId: string;
  let empresaId: string;
  let terceroId: string;
  let proyectoId: string;
  let partidaId: string;
  let cuentaBancariaId: string;
  // CxC chain
  let synEventoId: string;
  let cubicacionId: string;
  let facturaClienteId: string;
  let cxcId1: string;
  let cxcId2: string;
  let cxcOutId: string;  // semana 14 (fuera del horizonte)
  // OC
  let ocId: string;
  let lineaOcId: string;
  // Programación de pago
  let pagoProgId: string;

  // ── Servicio ──────────────────────────────────────────────────────────────
  let flujoCajaSvc: FlujoCajaService;

  // ── Fechas dinámicas ──────────────────────────────────────────────────────
  let fechaS1: string;
  let fechaS2: string;
  let fechaS3: string;
  let fechaS4: string;
  let fechaS5: string;
  let fechaS6: string;
  let fechaS14: string;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb = drizzle(adminPool, { schema });

    const uid = SYSTEM_USER_ID;
    const now = new Date();

    // Fechas dinámicas relativas a "hoy"
    fechaS1  = dateInWeek(1,  3);
    fechaS2  = dateInWeek(2,  3);
    fechaS3  = dateInWeek(3,  3);
    fechaS4  = dateInWeek(4,  3);
    fechaS5  = dateInWeek(5,  3);
    fechaS6  = dateInWeek(6,  3);
    fechaS14 = dateInWeek(14, 3);

    tenantId         = newId();
    empresaId        = newId();
    terceroId        = newId();
    proyectoId       = newId();
    partidaId        = newId();
    cuentaBancariaId = newId();
    synEventoId      = newId();
    cubicacionId     = newId();
    facturaClienteId = newId();
    cxcId1           = newId();
    cxcId2           = newId();
    cxcOutId         = newId();
    ocId             = newId();
    lineaOcId        = newId();
    pagoProgId       = newId();

    // ── Tenant + Empresa ──────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO tenant (id,nombre,slug,created_at,created_by,updated_at,updated_by)
       VALUES ($1,'FlujoCaja Tenant','fc-'||$2,now(),$3,now(),$3)`,
      [tenantId, tenantId.slice(-8), uid],
    );
    await adminPool.query(
      `INSERT INTO empresa (id,tenant_id,nombre,created_at,created_by,updated_at,updated_by)
       VALUES ($1,$2,'Empresa FC Test',now(),$3,now(),$3)`,
      [empresaId, tenantId, uid],
    );

    // ── Tercero ───────────────────────────────────────────────────────────
    await adminDb.insert(schema.terceros).values([{
      id: terceroId, tenantId, tipoIdentificacion: 'RNC', rncCedula: '101999900',
      nombreComercial: 'Cliente FC [test]', tipoContribuyente: 'PERSONA_JURIDICA',
      esCliente: true, esProveedor: false, esSubcontratista: false,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Proyecto ─────────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO proyecto (id,tenant_id,empresa_id,nombre,codigo,estado,tipo_obra,
        cliente_id,moneda_contrato,monto_contrato,presupuesto_vigente_monto,created_by,updated_by)
       VALUES ($1,$2,$3,'Proyecto FC','FC-001','EN_EJECUCION','OTRO',$4,'DOP','1000000.0000','0.0000',$5,$5)`,
      [proyectoId, tenantId, empresaId, terceroId, uid],
    );

    // ── Partida (para linea de OC) ────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO partida (id,tenant_id,proyecto_id,nivel,orden,numero_jerarquico,codigo,nombre,created_by,updated_by)
       VALUES ($1,$2,$3,1,1,'1','CAP-01','Capítulo OC Test',$4,$4)`,
      [partidaId, tenantId, proyectoId, uid],
    );

    // ── Cuenta bancaria (saldo_actual=50000 DOP) ──────────────────────────
    await adminPool.query(
      `INSERT INTO cuenta_bancaria (id,tenant_id,empresa_id,banco_nombre,numero_cuenta,tipo_cuenta,
        moneda,saldo_actual,cuenta_contable_codigo,activo,created_by,updated_by)
       VALUES ($1,$2,$3,'Banco Prueba FC','FC-0001','CORRIENTE','DOP','50000.0000','1.1.1.01',true,$4,$4)`,
      [cuentaBancariaId, tenantId, empresaId, uid],
    );

    // ── Evento operativo sintético (para FK de factura_cliente y CxC) ────
    await adminPool.query(
      `INSERT INTO evento_operativo (id,tenant_id,empresa_id,proyecto_id,tipo_evento,usuario_id,payload,idempotency_key,created_by)
       VALUES ($1,$2,$3,$4,'emision_factura_cliente',$5,'{}'::jsonb,$6,$5)`,
      [synEventoId, tenantId, empresaId, proyectoId, uid, `fc-evt-${synEventoId.slice(-8)}`],
    );

    // ── Cubicacion (para FK de factura_cliente) ────────────────────────────
    await adminPool.query(
      `INSERT INTO cubicacion (id,tenant_id,empresa_id,proyecto_id,numero,fecha_corte,
        monto_bruto,monto_retencion_garantia,monto_facturable,moneda,estado,created_by,updated_by)
       VALUES ($1,$2,$3,$4,1,'2026-01-10','100000.0000','0.0000','100000.0000','DOP','EMITIDA',$5,$5)`,
      [cubicacionId, tenantId, empresaId, proyectoId, uid],
    );

    // ── Factura cliente ───────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO factura_cliente (id,tenant_id,empresa_id,proyecto_id,cliente_id,cubicacion_id,
        numero,fecha_emision,monto_subtotal,monto_total,monto_neto_a_cobrar,estado,evento_id,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'FC-FC-001','2026-01-10','100000.0000','100000.0000','100000.0000','EMITIDA',$7,$8,$8)`,
      [facturaClienteId, tenantId, empresaId, proyectoId, terceroId, cubicacionId, synEventoId, uid],
    );

    // ── CxC 1: semana 3, monto_original=100000, monto_cobrado=0, PENDIENTE ──
    await adminPool.query(
      `INSERT INTO cuenta_por_cobrar (id,tenant_id,empresa_id,proyecto_id,factura_cliente_id,
        tercero_id,monto_original,monto_cobrado,moneda,fecha_emision,fecha_vencimiento,estado,evento_origen_id,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'100000.0000','0.0000','DOP','2026-01-10',$7,'PENDIENTE',$8,$9,$9)`,
      [cxcId1, tenantId, empresaId, proyectoId, facturaClienteId, terceroId, fechaS3, synEventoId, uid],
    );

    // ── CxC 2: semana 5, monto_original=150000, monto_cobrado=50000, PAGADA_PARCIAL ──
    await adminPool.query(
      `INSERT INTO cuenta_por_cobrar (id,tenant_id,empresa_id,proyecto_id,factura_cliente_id,
        tercero_id,monto_original,monto_cobrado,moneda,fecha_emision,fecha_vencimiento,estado,evento_origen_id,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'150000.0000','50000.0000','DOP','2026-01-10',$7,'PAGADA_PARCIAL',$8,$9,$9)`,
      [cxcId2, tenantId, empresaId, proyectoId, facturaClienteId, terceroId, fechaS5, synEventoId, uid],
    );

    // ── CxC "out of horizon": semana 14 ──────────────────────────────────
    await adminPool.query(
      `INSERT INTO cuenta_por_cobrar (id,tenant_id,empresa_id,proyecto_id,factura_cliente_id,
        tercero_id,monto_original,monto_cobrado,moneda,fecha_emision,fecha_vencimiento,estado,evento_origen_id,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'999000.0000','0.0000','DOP','2026-01-10',$7,'PENDIENTE',$8,$9,$9)`,
      [cxcOutId, tenantId, empresaId, proyectoId, facturaClienteId, terceroId, fechaS14, synEventoId, uid],
    );

    // ── OC EMITIDA en semana 1, monto=200000 ─────────────────────────────
    await adminPool.query(
      `INSERT INTO orden_compra (id,tenant_id,empresa_id,numero,estado,tercero_id,
        fecha_emision,fecha_entrega_prometida,total_monto,moneda,created_by,updated_by)
       VALUES ($1,$2,$3,'OC-FC-001','EMITIDA',$4,'2026-01-05',$5,'200000.0000','DOP',$6,$6)`,
      [ocId, tenantId, empresaId, terceroId, fechaS1, uid],
    );
    await adminPool.query(
      `INSERT INTO linea_orden_compra (id,tenant_id,orden_compra_id,partida_id,
        descripcion,cantidad,unidad_medida,precio_unitario,total,moneda,created_by,updated_by)
       VALUES ($1,$2,$3,$4,'Linea OC FC','1.0000','GLB','200000.0000','200000.0000','DOP',$5,$5)`,
      [lineaOcId, tenantId, ocId, partidaId, uid],
    );

    // ── Programación de pago en semana 2, monto=60000 ────────────────────
    // Cuenta por pagar mínima necesaria para el FK de programacion_pago
    const synEventoCxpId = newId();
    const fpId = newId();
    const cxpId = newId();
    await adminPool.query(
      `INSERT INTO evento_operativo (id,tenant_id,empresa_id,proyecto_id,tipo_evento,usuario_id,payload,idempotency_key,created_by)
       VALUES ($1,$2,$3,$4,'recepcion_factura_proveedor',$5,'{}'::jsonb,$6,$5)`,
      [synEventoCxpId, tenantId, empresaId, proyectoId, uid, `fc-cxp-${synEventoCxpId.slice(-8)}`],
    );
    await adminPool.query(
      `INSERT INTO factura_proveedor (id,tenant_id,empresa_id,tercero_id,numero,ncf,fecha_factura,
        monto_subtotal,monto_total,moneda,evento_id,created_by,updated_by)
       VALUES ($1,$2,$3,$4,'FP-FC-001','B01FC001','2026-01-05','60000.0000','60000.0000','DOP',$5,$6,$6)`,
      [fpId, tenantId, empresaId, terceroId, synEventoCxpId, uid],
    );
    await adminPool.query(
      `INSERT INTO cuenta_por_pagar (id,tenant_id,empresa_id,factura_proveedor_id,tercero_id,
        monto_original,monto_pagado,moneda,estado,evento_origen_id,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,'60000.0000','0.0000','DOP','PENDIENTE',$6,$7,$7)`,
      [cxpId, tenantId, empresaId, fpId, terceroId, synEventoCxpId, uid],
    );
    await adminPool.query(
      `INSERT INTO programacion_pago (id,tenant_id,empresa_id,cuenta_por_pagar_id,cuenta_bancaria_id,
        proyecto_id,monto,moneda,fecha_programada,prioridad,estado,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'60000.0000','DOP',$7,100,'PROGRAMADO',$8,$8)`,
      [pagoProgId, tenantId, empresaId, cxpId, cuentaBancariaId, proyectoId, fechaS2, uid],
    );

    // ── Servicio ──────────────────────────────────────────────────────────
    const dbSvc = { tx: adminDb } as unknown as DbService;
    flujoCajaSvc = new FlujoCajaService(dbSvc);

    // ── Cubicaciones proyectadas ───────────────────────────────────────────
    // cProy1: semana 4, sin vincular → debe aparecer
    await flujoCajaSvc.registrarCubicacionProyectada(tenantId, uid, {
      empresaId,
      proyectoId,
      fechaProyectada: fechaS4,
      montoProyectado: '75000.0000',
      descripcion: 'Cubicación proyectada semana 4',
    });

    // cProy2: semana 6, vinculada a cubicacion real → NO debe aparecer
    await adminPool.query(
      `INSERT INTO cubicacion_proyectada (id,tenant_id,empresa_id,proyecto_id,
        fecha_proyectada,monto_proyectado,moneda,descripcion,cubicacion_id,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,'50000.0000','DOP','Vinculada a real',$6,$7,$7)`,
      [newId(), tenantId, empresaId, proyectoId, fechaS6, cubicacionId, uid],
    );
  });

  afterAll(async () => {
    // Cubicaciones proyectadas
    await adminPool.query(`DELETE FROM cubicacion_proyectada WHERE tenant_id=$1`, [tenantId]);
    // Programaciones de pago
    await adminPool.query(`DELETE FROM programacion_pago WHERE tenant_id=$1`, [tenantId]);
    // Líneas de OC
    await adminPool.query(`DELETE FROM linea_orden_compra WHERE tenant_id=$1`, [tenantId]);
    // OC (con trigger no_delete)
    await adminPool.query(`ALTER TABLE orden_compra DISABLE TRIGGER no_delete_orden_compra`);
    await adminPool.query(`DELETE FROM orden_compra WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE orden_compra ENABLE TRIGGER no_delete_orden_compra`);
    // Partida (con trigger)
    await adminPool.query(`ALTER TABLE partida DISABLE TRIGGER no_delete_partida`);
    await adminPool.query(`DELETE FROM partida WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE partida ENABLE TRIGGER no_delete_partida`);
    // CxC
    await adminPool.query(`DELETE FROM cuenta_por_cobrar WHERE tenant_id=$1`, [tenantId]);
    // CxP (con trigger)
    await adminPool.query(`ALTER TABLE cuenta_por_pagar DISABLE TRIGGER no_delete_cuenta_por_pagar`);
    await adminPool.query(`DELETE FROM cuenta_por_pagar WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE cuenta_por_pagar ENABLE TRIGGER no_delete_cuenta_por_pagar`);
    // Factura proveedor (con trigger)
    await adminPool.query(`ALTER TABLE factura_proveedor DISABLE TRIGGER no_delete_factura_proveedor`);
    await adminPool.query(`UPDATE factura_proveedor SET evento_id=NULL WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM factura_proveedor WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE factura_proveedor ENABLE TRIGGER no_delete_factura_proveedor`);
    // Factura cliente
    await adminPool.query(`UPDATE factura_cliente SET evento_id=NULL WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`UPDATE cubicacion SET factura_cliente_id=NULL WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM factura_cliente WHERE tenant_id=$1`, [tenantId]);
    // Cubicacion
    await adminPool.query(`DELETE FROM cubicacion WHERE tenant_id=$1`, [tenantId]);
    // Eventos
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    // Cuenta bancaria
    await adminPool.query(`DELETE FROM cuenta_bancaria WHERE tenant_id=$1`, [tenantId]);
    // Proyecto (con trigger)
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);
    // Tercero
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id=$1`, [tenantId]);
    // Empresa (con trigger)
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    // Audit log + Tenant
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
  });

  // ── 01. Suma correcta de CxC en semana 3 ─────────────────────────────────

  it('01 — semana 3 totalInflows = 100.000 (CxC1) y totalOutflows = 0', async () => {
    const res = await flujoCajaSvc.calcularFlujoPorProyecto(tenantId, proyectoId, 13);
    const s3 = res.semanas.find(s => s.semana === 3)!;

    expect(s3).toBeDefined();
    expect(s3.totalInflows).toBe('100000.0000');
    expect(s3.totalOutflows).toBe('0.0000');
  });

  // ── 02. Déficit en semana 1 por OC grande sin cobros previos ─────────────

  it('02 — semana 1: OC de 200.000 sin cobros previos → alertaDeficit = true', async () => {
    const res = await flujoCajaSvc.calcularFlujoPorProyecto(tenantId, proyectoId, 13);
    const s1 = res.semanas.find(s => s.semana === 1)!;

    expect(s1.alertaDeficit).toBe(true);
    expect(parseFloat(s1.posicionAcumulada)).toBeLessThan(0);
  });

  // ── 03. CxC parcialmente pagada usa monto pendiente ──────────────────────

  it('03 — CxC con monto_cobrado=50.000 proyecta monto pendiente=100.000', async () => {
    const res = await flujoCajaSvc.calcularFlujoPorProyecto(tenantId, proyectoId, 13);
    const s5 = res.semanas.find(s => s.semana === 5)!;

    const itemCxc2 = s5.inflows.find(i => i.referenciaId === cxcId2);
    expect(itemCxc2).toBeDefined();
    expect(itemCxc2!.tipo).toBe('CXC_PENDIENTE');
    expect(itemCxc2!.monto).toBe('100000.0000'); // 150000 - 50000
  });

  // ── 04. Cubicación proyectada sin vincular → CXC_PROYECTADA en semana 4 ─

  it('04 — cubicación proyectada sin cubicacion_id → aparece como CXC_PROYECTADA en s4', async () => {
    const res = await flujoCajaSvc.calcularFlujoPorProyecto(tenantId, proyectoId, 13);
    const s4 = res.semanas.find(s => s.semana === 4)!;

    const item = s4.inflows.find(i => i.tipo === 'CXC_PROYECTADA');
    expect(item).toBeDefined();
    expect(item!.monto).toBe('75000.0000');
    expect(item!.referenciaTipo).toBe('cubicacion_proyectada');
  });

  // ── 05. Cubicación proyectada con cubicacion_id → NO aparece ─────────────

  it('05 — cubicación proyectada con cubicacion_id vinculado → no aparece en ningún inflow', async () => {
    const res = await flujoCajaSvc.calcularFlujoPorProyecto(tenantId, proyectoId, 13);
    const todosLosInflows = res.semanas.flatMap(s => s.inflows);
    const vinculada = todosLosInflows.find(
      i => i.tipo === 'CXC_PROYECTADA' && i.fechaEsperada === fechaS6,
    );
    expect(vinculada).toBeUndefined();
  });

  // ── 06. OC EMITIDA por partida del proyecto → OC_COMPROMETIDA en s1 ──────

  it('06 — OC EMITIDA con linea en partida del proyecto → OC_COMPROMETIDA en s1', async () => {
    const res = await flujoCajaSvc.calcularFlujoPorProyecto(tenantId, proyectoId, 13);
    const s1 = res.semanas.find(s => s.semana === 1)!;

    const itemOc = s1.outflows.find(i => i.tipo === 'OC_COMPROMETIDA' && i.referenciaId === ocId);
    expect(itemOc).toBeDefined();
    expect(itemOc!.monto).toBe('200000.0000');
    expect(itemOc!.referenciaTipo).toBe('orden_compra');
  });

  // ── 07. Consolidado: saldo inicial = suma de cuentas bancarias DOP ────────

  it('07 — consolidado: saldoInicial = 50.000 (cuenta bancaria DOP activa)', async () => {
    const res = await flujoCajaSvc.calcularFlujoConsolidado(tenantId, empresaId, 4);
    expect(res.saldoInicial).toBe('50000.0000');
    expect(res.horizonte).toBe(4);
    expect(res.semanas).toHaveLength(4);
  });

  // ── 08. Programación de pago → PAGO_PROGRAMADO en semana 2 ───────────────

  it('08 — programacion_pago PROGRAMADO → PAGO_PROGRAMADO en s2', async () => {
    const res = await flujoCajaSvc.calcularFlujoPorProyecto(tenantId, proyectoId, 13);
    const s2 = res.semanas.find(s => s.semana === 2)!;

    const itemPago = s2.outflows.find(
      i => i.tipo === 'PAGO_PROGRAMADO' && i.referenciaId === pagoProgId,
    );
    expect(itemPago).toBeDefined();
    expect(itemPago!.monto).toBe('60000.0000');
    expect(itemPago!.referenciaTipo).toBe('programacion_pago');
  });

  // ── 09. Ítem en semana 14 no aparece con horizonte=13 ────────────────────

  it('09 — CxC en semana 14 (fuera del horizonte=13) no aparece en ninguna semana', async () => {
    const res = await flujoCajaSvc.calcularFlujoPorProyecto(tenantId, proyectoId, 13);
    const todosLosInflows = res.semanas.flatMap(s => s.inflows);
    const fueraHorizonte = todosLosInflows.find(i => i.referenciaId === cxcOutId);
    expect(fueraHorizonte).toBeUndefined();
  });

  // ── 10. Trazabilidad P8: referenciaId y referenciaTipo presentes ──────────

  it('10 — cada ItemFlujo tiene referenciaId y referenciaTipo no vacíos (P8)', async () => {
    const res = await flujoCajaSvc.calcularFlujoPorProyecto(tenantId, proyectoId, 13);
    const todosLosItems = res.semanas.flatMap(s => [...s.inflows, ...s.outflows]);

    expect(todosLosItems.length).toBeGreaterThan(0);
    for (const item of todosLosItems) {
      expect(item.referenciaId).toBeTruthy();
      expect(item.referenciaTipo).toBeTruthy();
    }
  });
});
