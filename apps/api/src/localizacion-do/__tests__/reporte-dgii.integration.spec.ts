/**
 * PRUEBAS DE INTEGRACIÓN — Reportes DGII 606/607/608/623/IT-1 (Sesión 7 Capa 2, ADR-0010)
 *
 * 01. 606 incluye exactamente las facturas de proveedor del período
 * 02. 606 excluye facturas fuera del período
 * 03. 606 totaliza montoSubtotal y ITBIS correctamente
 * 04. 606 reconcilia contra asientos del libro mayor (ITBIS adelantado por cuenta 1106)
 * 05. 607 incluye solo comprobantes_ecf ACEPTADO del período
 * 06. 607 totaliza ITBIS cobrado correctamente
 * 07. 608 incluye solo comprobantes RECHAZADO del período (no los ACEPTADO)
 * 08. 623 solo incluye e-CF de ventas a clientes estatales con retenciones
 * 09. IT-1: ITBIS a pagar = cobrado − adelantado − retenido por Estado
 * 10. IT-1 reconcilia contra asientos (cuadra=true cuando ledger correcto)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import { DbService } from '../../database/db.service.js';
import { ReporteDgiiService } from '../reporte-dgii.service.js';

// ─── Conexiones ───────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

describe('Reportes DGII — 606/607/608/623/IT-1', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  let tenantId: string;
  let empresaId: string;
  let proveedorId: string;
  let proveedorFisicoId: string;
  let clienteId: string;
  let clienteEstatalId: string;
  let proyectoId: string;
  let cubicacionId: string;

  // facturas_proveedor
  let fpEnPeriodoId: string;    // fecha 2025-01-15 — E31 (servicios)
  let fpEnPeriodo2Id: string;   // fecha 2025-01-20 — E41 (bienes)
  let fpFueraPeriodoId: string; // fecha 2025-02-01 — fuera del período

  // comprobante_ecf
  let ecfAceptadoId: string;    // ACEPTADO 2025-01-10
  let ecfRechazadoId: string;   // RECHAZADO 2025-01-18

  // factura_cliente + comprobante para 623
  let facturaCliEstatalId: string;
  let ecfEstatalId: string;

  // cuentas contables + asientos para reconciliación IT-1
  let cuenta2102Id: string;     // ITBIS por pagar (pasivo)
  let cuenta1106Id: string;     // ITBIS adelantado (activo)
  let asientoVentaId: string;   // asiento de la venta
  let asientoCompraId: string;  // asiento de la compra

  let svc: ReporteDgiiService;

  const PERIODO_ANIO = 2025;
  const PERIODO_MES = 1;
  const uid = SYSTEM_USER_ID;
  const now = new Date();

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb = drizzle(adminPool, { schema });

    tenantId = newId();
    empresaId = newId();
    proveedorId = newId();
    proveedorFisicoId = newId();
    clienteId = newId();
    clienteEstatalId = newId();
    proyectoId = newId();
    cubicacionId = newId();
    fpEnPeriodoId = newId();
    fpEnPeriodo2Id = newId();
    fpFueraPeriodoId = newId();
    ecfAceptadoId = newId();
    ecfRechazadoId = newId();
    facturaCliEstatalId = newId();
    ecfEstatalId = newId();
    cuenta2102Id = newId();
    cuenta1106Id = newId();
    asientoVentaId = newId();
    asientoCompraId = newId();

    // ── Tenant + Empresa ─────────────────────────────────────────────────────
    await adminDb.insert(schema.tenants).values([{
      id: tenantId, nombre: 'T-DGII', slug: `dgii-${tenantId.slice(-12)}`,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.empresas).values([{
      id: empresaId, tenantId, nombre: 'Constructora DGII Test SRL',
      rnc: '130000099',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Terceros ─────────────────────────────────────────────────────────────
    await adminDb.insert(schema.terceros).values([
      {
        id: proveedorId, tenantId,
        tipoIdentificacion: 'RNC', rncCedula: '101000011',
        nombreComercial: 'Proveedor RNC SA',
        tipoContribuyente: 'PERSONA_JURIDICA', condicionDgii: 'NORMAL',
        esProveedor: true,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: proveedorFisicoId, tenantId,
        tipoIdentificacion: 'CEDULA', rncCedula: '00100200300',
        nombreComercial: 'Consultor Físico',
        tipoContribuyente: 'PERSONA_FISICA', condicionDgii: 'NORMAL',
        esProveedor: true,
        retencionIsrPct: '10.00',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: clienteId, tenantId,
        tipoIdentificacion: 'RNC', rncCedula: '102000022',
        nombreComercial: 'Cliente Privado SA',
        tipoContribuyente: 'PERSONA_JURIDICA', condicionDgii: 'NORMAL',
        esCliente: true,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: clienteEstatalId, tenantId,
        tipoIdentificacion: 'RNC', rncCedula: '401000003',
        nombreComercial: 'Ministerio de Obras Públicas',
        tipoContribuyente: 'PERSONA_JURIDICA', condicionDgii: 'NORMAL',
        esCliente: true, esInstitucionEstatal: true,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // ── Proyecto + Cubicación ────────────────────────────────────────────────
    await adminDb.insert(schema.proyectos).values([{
      id: proyectoId, tenantId, empresaId, clienteId: clienteEstatalId,
      nombre: 'Obra Vial MOPC', codigo: 'PRY-DGII-1', estado: 'EN_EJECUCION',
      monedaContrato: 'DOP', montoContrato: '5000000.0000', tipoObra: 'VIAL',
      presupuestoVigenteMonto: '0.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminPool.query(
      `INSERT INTO cubicacion (id,tenant_id,empresa_id,proyecto_id,numero,fecha_corte,
        monto_bruto,monto_facturable,moneda,estado,created_by,updated_by)
       VALUES ($1,$2,$3,$4,1,'2025-01-10','1000000.0000','1000000.0000','DOP','EMITIDA',$5,$5)`,
      [cubicacionId, tenantId, empresaId, proyectoId, uid],
    );

    // ── Facturas de proveedor ────────────────────────────────────────────────
    // fp1: E31 (servicios), en período
    await adminDb.insert(schema.facturasProveedor).values([{
      id: fpEnPeriodoId, tenantId, empresaId,
      terceroId: proveedorFisicoId,
      numero: 'FP-001', ncf: 'E310000000011', tipoEcf: 'E31', ecfValidado: true,
      fechaFactura: '2025-01-15',
      montoSubtotal: '55555.5600', montoItbis: '10000.0000', montoTotal: '65555.5600',
      moneda: 'DOP', estadoMatch: 'OK', estadoCxp: 'PENDIENTE',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // fp2: E41 (bienes), en período
    await adminDb.insert(schema.facturasProveedor).values([{
      id: fpEnPeriodo2Id, tenantId, empresaId,
      terceroId: proveedorId,
      numero: 'FP-002', ncf: 'E410000000021', tipoEcf: 'E41', ecfValidado: false,
      fechaFactura: '2025-01-20',
      montoSubtotal: '200000.0000', montoItbis: '0.0000', montoTotal: '200000.0000',
      moneda: 'DOP', estadoMatch: 'OK', estadoCxp: 'PENDIENTE',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // fp3: Febrero — FUERA del período
    await adminDb.insert(schema.facturasProveedor).values([{
      id: fpFueraPeriodoId, tenantId, empresaId,
      terceroId: proveedorId,
      numero: 'FP-003', ncf: 'E310000000031', tipoEcf: 'E31', ecfValidado: true,
      fechaFactura: '2025-02-05',
      montoSubtotal: '100000.0000', montoItbis: '18000.0000', montoTotal: '118000.0000',
      moneda: 'DOP', estadoMatch: 'OK', estadoCxp: 'PENDIENTE',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── e-CF de venta: ACEPTADO ──────────────────────────────────────────────
    // Factura cliente (cliente privado) + comprobante ACEPTADO
    const facturaCli1Id = newId();
    const evento606Id = newId();
    await adminPool.query(
      `INSERT INTO evento_operativo
         (id,tenant_id,empresa_id,proyecto_id,tipo_evento,usuario_id,payload,idempotency_key,created_by)
       VALUES ($1,$2,$3,$4,'emision_factura_cliente',$5,'{}',gen_random_uuid(),$5)`,
      [evento606Id, tenantId, empresaId, proyectoId, uid],
    );
    await adminDb.insert(schema.facturasCliente).values([{
      id: facturaCli1Id, tenantId, empresaId, proyectoId,
      clienteId,
      cubicacionId,
      numero: 'FC-001',
      fechaEmision: '2025-01-10',
      montoSubtotal: '100000.0000', montoItbis: '18000.0000',
      montoRetencionIsr: '0.0000', montoRetencionItbis: '0.0000',
      montoTotal: '118000.0000', montoNetoACobrar: '118000.0000',
      moneda: 'DOP', estado: 'EMITIDA',
      eventoId: evento606Id,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.comprobantesEcf).values([{
      id: ecfAceptadoId, tenantId, empresaId, proyectoId,
      facturaClienteId: facturaCli1Id,
      tipoEcf: 'E31', ncf: 'E310000000101',
      estado: 'ACEPTADO',
      documento: { receptor: { rncOCedula: '102000022', razonSocial: 'Cliente Privado SA' } },
      hashIntegridad: 'aaa',
      montoSubtotal: '100000.0000', montoItbis: '18000.0000', montoTotal: '118000.0000',
      moneda: 'DOP',
      fechaEmision: '2025-01-10',
      retenerHasta: '2035-01-10',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── e-CF de venta: RECHAZADO ─────────────────────────────────────────────
    await adminDb.insert(schema.comprobantesEcf).values([{
      id: ecfRechazadoId, tenantId, empresaId, proyectoId,
      facturaClienteId: null,
      tipoEcf: 'E31', ncf: 'E310000000199',
      estado: 'RECHAZADO',
      documento: { receptor: { rncOCedula: '102000022', razonSocial: 'Cliente Privado SA' } },
      hashIntegridad: 'bbb',
      montoSubtotal: '50000.0000', montoItbis: '9000.0000', montoTotal: '59000.0000',
      moneda: 'DOP',
      fechaEmision: '2025-01-18',
      retenerHasta: '2035-01-18',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Factura cliente + e-CF para cliente estatal (623) ────────────────────
    const cubEstatalId = newId();
    await adminPool.query(
      `INSERT INTO cubicacion (id,tenant_id,empresa_id,proyecto_id,numero,fecha_corte,
        monto_bruto,monto_facturable,moneda,estado,created_by,updated_by)
       VALUES ($1,$2,$3,$4,2,'2025-01-25','500000.0000','500000.0000','DOP','EMITIDA',$5,$5)`,
      [cubEstatalId, tenantId, empresaId, proyectoId, uid],
    );

    const eventoEstatalId = newId();
    await adminPool.query(
      `INSERT INTO evento_operativo
         (id,tenant_id,empresa_id,proyecto_id,tipo_evento,usuario_id,payload,idempotency_key,created_by)
       VALUES ($1,$2,$3,$4,'emision_factura_cliente',$5,'{}',gen_random_uuid(),$5)`,
      [eventoEstatalId, tenantId, empresaId, proyectoId, uid],
    );

    await adminDb.insert(schema.facturasCliente).values([{
      id: facturaCliEstatalId, tenantId, empresaId, proyectoId,
      clienteId: clienteEstatalId,
      cubicacionId: cubEstatalId,
      numero: 'FC-002',
      fechaEmision: '2025-01-25',
      montoSubtotal: '500000.0000', montoItbis: '90000.0000',
      montoRetencionIsr: '25000.0000', montoRetencionItbis: '90000.0000',
      montoTotal: '590000.0000', montoNetoACobrar: '475000.0000',
      moneda: 'DOP', estado: 'EMITIDA',
      eventoId: eventoEstatalId,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.comprobantesEcf).values([{
      id: ecfEstatalId, tenantId, empresaId, proyectoId,
      facturaClienteId: facturaCliEstatalId,
      tipoEcf: 'E31', ncf: 'E310000000201',
      estado: 'ACEPTADO',
      documento: { receptor: { rncOCedula: '401000003', razonSocial: 'Ministerio de Obras Públicas' } },
      hashIntegridad: 'ccc',
      montoSubtotal: '500000.0000', montoItbis: '90000.0000', montoTotal: '590000.0000',
      moneda: 'DOP',
      fechaEmision: '2025-01-25',
      retenerHasta: '2035-01-25',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Cuentas contables + asientos para reconciliación IT-1 ────────────────
    await adminDb.insert(schema.cuentasContables).values([
      {
        id: cuenta2102Id, tenantId, empresaId,
        codigo: '2102', nombre: 'ITBIS por Pagar',
        tipo: 'pasivo', naturaleza: 'acreedora', nivel: 3,
        esCuenta: true, esMovimiento: true, activo: true,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: cuenta1106Id, tenantId, empresaId,
        codigo: '1106', nombre: 'ITBIS Adelantado',
        tipo: 'activo', naturaleza: 'deudora', nivel: 3,
        esCuenta: true, esMovimiento: true, activo: true,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    const cuenta1101Id = newId();
    const cuenta4101Id = newId();
    const cuenta5101Id = newId();
    const cuenta2101Id = newId();

    await adminDb.insert(schema.cuentasContables).values([
      { id: cuenta1101Id, tenantId, empresaId, codigo: '1101', nombre: 'CxC', tipo: 'activo', naturaleza: 'deudora', nivel: 3, esCuenta: true, esMovimiento: true, activo: true, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
      { id: cuenta4101Id, tenantId, empresaId, codigo: '4101', nombre: 'Ingresos', tipo: 'ingreso', naturaleza: 'acreedora', nivel: 3, esCuenta: true, esMovimiento: true, activo: true, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
      { id: cuenta5101Id, tenantId, empresaId, codigo: '5101', nombre: 'Gastos', tipo: 'gasto', naturaleza: 'deudora', nivel: 3, esCuenta: true, esMovimiento: true, activo: true, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
      { id: cuenta2101Id, tenantId, empresaId, codigo: '2101', nombre: 'CxP', tipo: 'pasivo', naturaleza: 'acreedora', nivel: 3, esCuenta: true, esMovimiento: true, activo: true, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);

    // Asiento de venta: DEBE CxC 118000 / HABER Ingresos 100000 / HABER 2102 18000
    await adminDb.insert(schema.asientosContables).values([{
      id: asientoVentaId, tenantId, empresaId,
      numero: 'AST-2025-V01', tipo: 'ajuste',
      fecha: '2025-01-10', descripcion: 'Factura cliente FC-001',
      estado: 'confirmado',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.lineasAsiento).values([
      { id: newId(), tenantId, asientoId: asientoVentaId, cuentaId: cuenta1101Id, tipo: 'debe', importe: '118000.0000', moneda: 'DOP' },
      { id: newId(), tenantId, asientoId: asientoVentaId, cuentaId: cuenta4101Id, tipo: 'haber', importe: '100000.0000', moneda: 'DOP' },
      { id: newId(), tenantId, asientoId: asientoVentaId, cuentaId: cuenta2102Id, tipo: 'haber', importe: '18000.0000', moneda: 'DOP' },
    ]);

    // Asiento de venta estatal: DEBE CxC 475000 / DEBE Ret-x-cobrar 90000 / HABER Ingresos 500000 / HABER 2102 90000
    const asientoVentaEstatalId = newId();
    await adminDb.insert(schema.asientosContables).values([{
      id: asientoVentaEstatalId, tenantId, empresaId,
      numero: 'AST-2025-VE01', tipo: 'ajuste',
      fecha: '2025-01-25', descripcion: 'Factura cliente FC-002 (Estatal)',
      estado: 'confirmado',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.lineasAsiento).values([
      // CxC por el bruto: luego el pago parcial salda la diferencia
      { id: newId(), tenantId, asientoId: asientoVentaEstatalId, cuentaId: cuenta1101Id, tipo: 'debe', importe: '590000.0000', moneda: 'DOP' },
      { id: newId(), tenantId, asientoId: asientoVentaEstatalId, cuentaId: cuenta4101Id, tipo: 'haber', importe: '500000.0000', moneda: 'DOP' },
      { id: newId(), tenantId, asientoId: asientoVentaEstatalId, cuentaId: cuenta2102Id, tipo: 'haber', importe: '90000.0000', moneda: 'DOP' },
    ]);

    // Asiento de compra: DEBE Gastos 55555.56 / DEBE 1106 10000 / HABER CxP 65555.56
    await adminDb.insert(schema.asientosContables).values([{
      id: asientoCompraId, tenantId, empresaId,
      numero: 'AST-2025-C01', tipo: 'ajuste',
      fecha: '2025-01-15', descripcion: 'Factura proveedor FP-001',
      estado: 'confirmado',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.lineasAsiento).values([
      { id: newId(), tenantId, asientoId: asientoCompraId, cuentaId: cuenta5101Id, tipo: 'debe', importe: '55555.5600', moneda: 'DOP' },
      { id: newId(), tenantId, asientoId: asientoCompraId, cuentaId: cuenta1106Id, tipo: 'debe', importe: '10000.0000', moneda: 'DOP' },
      { id: newId(), tenantId, asientoId: asientoCompraId, cuentaId: cuenta2101Id, tipo: 'haber', importe: '65555.5600', moneda: 'DOP' },
    ]);

    // ── Servicio bajo prueba ─────────────────────────────────────────────────
    const dbSvc = { tx: adminDb } as unknown as DbService;
    svc = new ReporteDgiiService(dbSvc);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────
  async function withTenant<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  // ── 01. 606 incluye exactamente las facturas del período ──────────────────
  it('01. 606: incluye exactamente las facturas del período', async () => {
    const reporte = await withTenant(() => svc.generar606(tenantId, empresaId, PERIODO_ANIO, PERIODO_MES));
    expect(reporte.totales.facturas).toBe(2);
    const ncfs = reporte.filas.map((f) => f.ncf);
    expect(ncfs).toContain('E310000000011');
    expect(ncfs).toContain('E410000000021');
    expect(ncfs).not.toContain('E310000000031'); // febrero — fuera del período
  });

  // ── 02. 606 excluye facturas fuera del período ────────────────────────────
  it('02. 606: excluye facturas de otros meses', async () => {
    const reporteFeb = await withTenant(() => svc.generar606(tenantId, empresaId, 2025, 2));
    expect(reporteFeb.totales.facturas).toBe(1);
    expect(reporteFeb.filas[0]?.ncf).toBe('E310000000031');
  });

  // ── 03. 606 totaliza correctamente ───────────────────────────────────────
  it('03. 606: totaliza montos e ITBIS correctamente', async () => {
    const reporte = await withTenant(() => svc.generar606(tenantId, empresaId, PERIODO_ANIO, PERIODO_MES));
    // Subtotal = 55555.5600 + 200000.0000 = 255555.5600
    expect(parseFloat(reporte.totales.montoSubtotal)).toBeCloseTo(255555.56, 2);
    // ITBIS = 10000 + 0 = 10000
    expect(parseFloat(reporte.totales.montoItbis)).toBeCloseTo(10000, 2);
    // ISR retenido: persona física con 10% ISR → 55555.56 × 10% = 5555.56
    expect(parseFloat(reporte.totales.isrRetenido)).toBeCloseTo(5555.56, 1);
    // Proveedor RNC sin retención → 0
    const fpBienes = reporte.filas.find((f) => f.tipoBienServicio === 'B');
    expect(fpBienes).toBeDefined();
    expect(parseFloat(fpBienes!.isrRetenido)).toBe(0);
  });

  // ── 04. 606 reconcilia ITBIS adelantado vs asientos ──────────────────────
  it('04. 606: ITBIS adelantado (solo E31 validados) coincide con asiento cuenta 1106', async () => {
    const reporte = await withTenant(() => svc.generar606(tenantId, empresaId, PERIODO_ANIO, PERIODO_MES));
    // Solo fp1 es E31 y validado → ITBIS adelantado = 10000
    const soloE31 = reporte.filas.filter((f) => f.tipoBienServicio === 'S');
    const itbisE31 = soloE31.reduce((acc, f) => acc + parseFloat(f.montoItbis), 0);
    expect(itbisE31).toBeCloseTo(10000, 2);

    // El asiento de compra insertado tiene cuenta 1106 DEBE 10000
    // Verify via IT-1 que el contable coincide
    const it1 = await withTenant(() => svc.generarIT1(tenantId, empresaId, PERIODO_ANIO, PERIODO_MES));
    expect(parseFloat(it1.reconciliacion.itbisAdelantadoContable)).toBeCloseTo(10000, 2);
    expect(parseFloat(it1.itbisAdelantado)).toBeCloseTo(10000, 2); // solo E31 validados
  });

  // ── 05. 607 incluye solo e-CF ACEPTADO del período ───────────────────────
  it('05. 607: incluye solo comprobantes ACEPTADO del período', async () => {
    const reporte = await withTenant(() => svc.generar607(tenantId, empresaId, PERIODO_ANIO, PERIODO_MES));
    // ecfAceptado (E31) + ecfEstatal (E31) — ambos ACEPTADO en enero 2025
    expect(reporte.totales.comprobantes).toBe(2);
    const ncfs = reporte.filas.map((f) => f.ncf);
    expect(ncfs).toContain('E310000000101');
    expect(ncfs).toContain('E310000000201');
    // RECHAZADO no debe aparecer
    expect(ncfs).not.toContain('E310000000199');
  });

  // ── 06. 607 totaliza ITBIS cobrado ───────────────────────────────────────
  it('06. 607: totaliza ITBIS cobrado correctamente', async () => {
    const reporte = await withTenant(() => svc.generar607(tenantId, empresaId, PERIODO_ANIO, PERIODO_MES));
    // ITBIS: ecfAceptado=18000 + ecfEstatal=90000 = 108000
    expect(parseFloat(reporte.totales.montoItbis)).toBeCloseTo(108000, 2);
  });

  // ── 07. 608 incluye solo RECHAZADO (no los ACEPTADO) ────────────────────
  it('07. 608: solo incluye comprobantes RECHAZADO del período', async () => {
    const reporte = await withTenant(() => svc.generar608(tenantId, empresaId, PERIODO_ANIO, PERIODO_MES));
    expect(reporte.totales.anulados).toBe(1);
    expect(reporte.filas[0]?.ncf).toBe('E310000000199');
  });

  // ── 08. 623 solo incluye e-CF con clientes estatales ─────────────────────
  it('08. 623: incluye solo facturas de ventas a clientes estatales con retenciones', async () => {
    const reporte = await withTenant(() => svc.generar623(tenantId, empresaId, PERIODO_ANIO, PERIODO_MES));
    expect(reporte.totales.documentos).toBe(1);
    const fila = reporte.filas[0]!;
    expect(fila.rncRetenedor).toBe('401000003');
    expect(fila.ncfDocumento).toBe('E310000000201');
    expect(parseFloat(fila.itbisRetenido)).toBeCloseTo(90000, 2);
    expect(parseFloat(fila.isrRetenido)).toBeCloseTo(25000, 2);
  });

  // ── 09. IT-1: ITBIS a pagar = cobrado − adelantado − retenido por Estado ─
  it('09. IT-1: ITBIS a pagar = cobrado − adelantado − retenidoPorEstado', async () => {
    const it1 = await withTenant(() => svc.generarIT1(tenantId, empresaId, PERIODO_ANIO, PERIODO_MES));
    // cobrado: ecfAceptado(E31)=18000 + ecfEstatal(E31)=90000 = 108000
    expect(parseFloat(it1.itbisCobrado)).toBeCloseTo(108000, 2);
    // adelantado: solo E31 validados = fp1.montoItbis = 10000
    expect(parseFloat(it1.itbisAdelantado)).toBeCloseTo(10000, 2);
    // retenidoPorEstado: factura_cli_estatal.monto_retencion_itbis = 90000
    expect(parseFloat(it1.itbisRetenidoPorEstado)).toBeCloseTo(90000, 2);
    // a pagar = 108000 - 10000 - 90000 = 8000
    expect(parseFloat(it1.itbisAPagar)).toBeCloseTo(8000, 2);
  });

  // ── 10. IT-1 reconcilia contra asientos (cuadra=true) ────────────────────
  it('10. IT-1: reconcilia contra asientos del libro mayor (cuadra=true)', async () => {
    const it1 = await withTenant(() => svc.generarIT1(tenantId, empresaId, PERIODO_ANIO, PERIODO_MES));
    // Cuenta 2102 HABER: asientoVenta=18000 + asientoVentaEstatal=90000 → net CR = 108000
    expect(parseFloat(it1.reconciliacion.itbisPorPagarContable)).toBeCloseTo(108000, 2);
    // Cuenta 1106 DEBE 10000 (solo asiento compra, no aparece en venta estatal) → net DR = 10000
    expect(parseFloat(it1.reconciliacion.itbisAdelantadoContable)).toBeCloseTo(10000, 2);
    // diferencia = (cobrado 108000 - contable 108000) + (adelantado 10000 - contable 10000) = 0 → cuadra
    expect(it1.reconciliacion.cuadra).toBe(true);
  });

  // ── afterAll: limpieza ────────────────────────────────────────────────────
  afterAll(async () => {
    // Limpiar en orden inverso de dependencias
    await adminPool.query(`DELETE FROM linea_asiento WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM asiento_contable WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM cuenta_contable WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM comprobante_ecf WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM factura_cliente WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE factura_proveedor DISABLE TRIGGER no_delete_factura_proveedor`);
    await adminPool.query(`DELETE FROM factura_proveedor WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE factura_proveedor ENABLE TRIGGER no_delete_factura_proveedor`);
    await adminPool.query(`DELETE FROM cubicacion WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
  });
});
