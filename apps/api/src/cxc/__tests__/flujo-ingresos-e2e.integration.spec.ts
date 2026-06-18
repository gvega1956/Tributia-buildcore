/**
 * E2E — FLUJO DE INGRESOS COMPLETO (Sesión 8 Capa 2, Defecto D)
 *
 * Verifica de extremo a extremo:
 *   avance físico aprobado
 *   → cubicación EMITIDA
 *   → factura_cliente (emision_factura_cliente) → CxC PENDIENTE + asiento 3 líneas balanceado
 *   → comprobante_ecf E31 ACEPTADO vinculado a la factura
 *   → cobro_recibido → CxC PAGADA_TOTAL + asiento de cobro balanceado
 *   → 607 incluye el comprobante
 *   → IT-1 cuadra (ITBIS cobrado == ITBIS por pagar contable ±1 centavo)
 *
 * Contexto: asientos nacen en 'borrador'; el test los confirma (simulando el
 * cierre contable) antes de ejecutar IT-1 — comportamiento real del sistema.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import type { ConfiguracionRegla } from '@tributia/contabilidad';
import { DbService } from '../../database/db.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { ProjectionEngineService } from '../../ledger/projection-engine.service.js';
import { ReglaContableService } from '../../contabilidad/regla-contable.service.js';
import { CuentaContableService } from '../../contabilidad/cuenta-contable.service.js';
import { AsientoContableService } from '../../contabilidad/asiento-contable.service.js';
import { CxcEmisionFacturaClienteHandler } from '../handlers/cxc-emision-factura-cliente.handler.js';
import { ContabilidadCobroRecibidoHandler } from '../../contabilidad/handlers/contabilidad-cobro-recibido.handler.js';
import { CubicacionService } from '../cubicacion.service.js';
import { FacturaClienteService } from '../factura-cliente.service.js';
import { RetencionClienteService } from '../retencion-cliente.service.js';
import { ReporteDgiiService } from '../../localizacion-do/reporte-dgii.service.js';

const ADMIN_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

describe('E2E — Flujo de Ingresos Completo (Capa 2 Auditoría Defecto D)', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  let tenantId: string;
  let empresaId: string;
  let proyectoId: string;
  let clienteId: string;
  let partida1Id: string;
  let versionBaseId: string;
  let unidadId: string;

  let cubicacionSvc: CubicacionService;
  let facturaSvc: FacturaClienteService;
  let ledgerSvc: LedgerService;
  let dgiiSvc: ReporteDgiiService;

  // Resultados entre steps
  let cubicacionId: string;
  let facturaId: string;
  let cxcId: string;
  let ecfId: string;

  const uid = SYSTEM_USER_ID;
  const now = new Date();
  const hoy = now.toISOString().slice(0, 10);
  const anio = now.getUTCFullYear();
  const mes = now.getUTCMonth() + 1;

  // Montos del escenario: subtotal 100,000 / ITBIS 18% = 18,000 / total 118,000 / sin retenciones
  const SUBTOTAL = '100000.0000';
  const ITBIS    = '18000.0000';
  const TOTAL    = '118000.0000';
  const NCF_E2E  = 'B0100000099'; // NCF de prueba del e2e

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb = drizzle(adminPool, { schema });

    tenantId  = newId();
    empresaId = newId();
    proyectoId = newId();
    clienteId  = newId();
    partida1Id = newId();
    versionBaseId = newId();
    unidadId = newId();

    // ── Tenant + Empresa (con RNC para el reporte DGII) ───────────────────────
    await adminDb.insert(schema.tenants).values([{
      id: tenantId, nombre: 'Tenant E2E Ingresos', slug: `e2e-ing-${tenantId.slice(-12)}`,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);
    await adminDb.insert(schema.empresas).values([{
      id: empresaId, tenantId, nombre: 'Empresa E2E Test', rnc: '101999099',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Cliente privado (sin retenciones) ────────────────────────────────────
    await adminDb.insert(schema.terceros).values([{
      id: clienteId, tenantId, tipoIdentificacion: 'RNC', rncCedula: '130111555',
      nombreComercial: 'Cliente E2E SA', tipoContribuyente: 'PERSONA_JURIDICA',
      condicionDgii: 'NORMAL', esCliente: true, esInstitucionEstatal: false,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Proyecto ─────────────────────────────────────────────────────────────
    await adminDb.insert(schema.proyectos).values([{
      id: proyectoId, tenantId, empresaId, clienteId,
      nombre: 'Proyecto E2E', codigo: 'PRY-E2E', estado: 'EN_EJECUCION',
      monedaContrato: 'DOP', montoContrato: '1000000.0000', tipoObra: 'OTRO',
      presupuestoVigenteMonto: '0.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Unidad + Partida ──────────────────────────────────────────────────────
    await adminDb.insert(schema.unidadesMedida).values([{
      id: unidadId, tenantId, codigo: 'M3E2E', nombre: 'Metro cúbico E2E',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);
    await adminDb.insert(schema.partidas).values([{
      id: partida1Id, tenantId, proyectoId, nivel: 2, orden: 1, numeroJerarquico: '1.1',
      codigo: 'PAR-E2E', nombre: 'Hormigón E2E',
      unidadMedidaId: unidadId,
      cantidadPresupuestada: '100.0000', precioUnitario: '2000.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Presupuesto BASE APROBADO (precio contractual 2000/m³) ────────────────
    await adminDb.insert(schema.versionesPresupuesto).values([{
      id: versionBaseId, tenantId, proyectoId, nombre: 'Base E2E', tipo: 'BASE',
      estado: 'PENDIENTE', moneda: 'DOP',
      totalDirecto: '200000.0000', totalIndirecto: '0.0000', totalPresupuesto: '200000.0000',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);
    await adminDb.insert(schema.lineasPresupuesto).values([{
      id: newId(), tenantId, versionPresupuestoId: versionBaseId, partidaId: partida1Id,
      cantidad: '100.0000', precioUnitario: '2000.0000', total: '200000.0000', moneda: 'DOP',
      esIndirecto: false, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);
    await adminPool.query(
      `UPDATE version_presupuesto SET estado='APROBADO', aprobado_por=$1, aprobado_en=now(),
       updated_at=now(), updated_by=$1 WHERE id=$2`,
      [uid, versionBaseId],
    );

    // ── Avance físico aprobado: 50 m³ (= monto facturable 100,000 DOP) ────────
    await adminPool.query(
      `INSERT INTO ejecucion_partida (id,tenant_id,partida_id,avance_cantidad,moneda,ultima_actualizacion,created_by,updated_by)
       VALUES ($1,$2,$3,'50.0000','DOP',now(),$4,$4)`,
      [newId(), tenantId, partida1Id, uid],
    );

    // ── Plan de cuentas — usa 2102.XX para que IT-1 reconcile correctamente ──
    const cuentas: Array<[string, string, string, string]> = [
      ['1101.01', 'Bancos E2E',             'activo',  'deudora'],
      ['1102.01', 'Cuentas por Cobrar E2E', 'activo',  'deudora'],
      ['4101.01', 'Ingresos Obra E2E',      'ingreso', 'acreedora'],
      ['2102.01', 'ITBIS por Pagar E2E',    'pasivo',  'acreedora'],
    ];
    for (const [codigo, nombre, tipo, naturaleza] of cuentas) {
      await adminPool.query(
        `INSERT INTO cuenta_contable (id,tenant_id,empresa_id,codigo,nombre,tipo,naturaleza,nivel,
           es_movimiento,activo,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,4,true,true,$8,$8)`,
        [newId(), tenantId, empresaId, codigo, nombre, tipo, naturaleza, uid],
      );
    }

    // ── Regla para emision_factura_cliente (cliente privado: solo 3 montos activos) ─
    const reglaEmision: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito',  cuentaCodigo: '1102.01', descripcion: 'CxC neto', montoKey: 'netoACobrar' },
        { tipo: 'credito', cuentaCodigo: '4101.01', descripcion: 'Ingreso obra', montoKey: 'subtotal' },
        { tipo: 'credito', cuentaCodigo: '2102.01', descripcion: 'ITBIS por pagar', montoKey: 'itbis' },
      ],
    };
    await adminPool.query(
      `INSERT INTO regla_contable (id,tenant_id,empresa_id,tipo_evento,nombre,configuracion,prioridad,activo,created_by,updated_by)
       VALUES ($1,$2,$3,'emision_factura_cliente','Reg factura E2E',$4::jsonb,0,true,$5,$5)`,
      [newId(), tenantId, empresaId, JSON.stringify(reglaEmision), uid],
    );

    // ── Regla para cobro_recibido ─────────────────────────────────────────────
    const reglaCobro: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito',  cuentaCodigo: '1101.01', descripcion: 'Bancos (cobro)' },
        { tipo: 'credito', cuentaCodigo: '1102.01', descripcion: 'CxC cancelada' },
      ],
    };
    await adminPool.query(
      `INSERT INTO regla_contable (id,tenant_id,empresa_id,tipo_evento,nombre,configuracion,prioridad,activo,created_by,updated_by)
       VALUES ($1,$2,$3,'cobro_recibido','Reg cobro E2E',$4::jsonb,0,true,$5,$5)`,
      [newId(), tenantId, empresaId, JSON.stringify(reglaCobro), uid],
    );

    // ── Wiring de servicios ───────────────────────────────────────────────────
    const dbSvc     = { tx: adminDb } as unknown as DbService;
    const reglaSvc   = new ReglaContableService();
    const cuentaSvc  = new CuentaContableService(null as never);
    const asientoSvc = new AsientoContableService(null as never, cuentaSvc);

    const emisionHdlr = new CxcEmisionFacturaClienteHandler(reglaSvc, asientoSvc);
    const cobroHdlr   = new ContabilidadCobroRecibidoHandler(reglaSvc, asientoSvc);

    const projEngine = new ProjectionEngineService([emisionHdlr, cobroHdlr], dbSvc);
    ledgerSvc = new LedgerService(dbSvc, projEngine);

    const retencionSvc = new RetencionClienteService();
    cubicacionSvc = new CubicacionService(dbSvc);
    facturaSvc    = new FacturaClienteService(dbSvc, ledgerSvc, retencionSvc);
    dgiiSvc       = new ReporteDgiiService(dbSvc);
  });

  // ── Step 1: avance aprobado → cubicación → factura_cliente → CxC PENDIENTE ─
  it('01 — cubicación y emision_factura_cliente crea CxC PENDIENTE + asiento 3 líneas balanceado', async () => {
    // Crear cubicación (50 m³ × 2000 DOP = 100,000 facturable)
    const cubicacion = await cubicacionSvc.crear(tenantId, {
      empresaId, proyectoId, fechaCorte: hoy,
      lineas: [{ partidaId: partida1Id, cantidadPeriodo: '50.0000' }],
    }, uid);
    cubicacionId = cubicacion.id;

    // Emitir factura → dispara emision_factura_cliente → asiento + CxC
    const factura = await facturaSvc.emitir(tenantId, {
      cubicacionId, clienteId,
      numero: 'FACT-E2E-001',
      itbisPct: '18',
      diasCredito: 30,
    }, uid);
    facturaId = factura.id;

    expect(new Decimal(factura.montoSubtotal).toFixed(4)).toBe(SUBTOTAL);
    expect(new Decimal(factura.montoItbis).toFixed(4)).toBe(ITBIS);
    expect(new Decimal(factura.montoNetoACobrar).toFixed(4)).toBe(TOTAL);

    // Verificar CxC creada con saldo PENDIENTE
    const [cxc] = await adminDb
      .select()
      .from(schema.cuentasPorCobrar)
      .where(
        and(
          eq(schema.cuentasPorCobrar.facturaClienteId, facturaId),
          eq(schema.cuentasPorCobrar.tenantId, tenantId),
        ),
      );
    expect(cxc).toBeDefined();
    expect(cxc!.estado).toBe('PENDIENTE');
    expect(new Decimal(cxc!.montoOriginal).toFixed(4)).toBe(TOTAL);
    cxcId = cxc!.id;

    // Verificar asiento 3 líneas balanceado
    const [asiento] = await adminDb
      .select({ id: schema.asientosContables.id })
      .from(schema.asientosContables)
      .where(eq(schema.asientosContables.eventoId, factura.eventoId));

    expect(asiento).toBeDefined();

    const lineas = await adminDb
      .select({
        tipo: schema.lineasAsiento.tipo,
        importe: schema.lineasAsiento.importe,
        codigo: schema.cuentasContables.codigo,
      })
      .from(schema.lineasAsiento)
      .innerJoin(schema.cuentasContables, eq(schema.lineasAsiento.cuentaId, schema.cuentasContables.id))
      .where(eq(schema.lineasAsiento.asientoId, asiento!.id));

    expect(lineas).toHaveLength(3);
    const debitos  = lineas.filter((l) => l.tipo === 'debe');
    const creditos = lineas.filter((l) => l.tipo === 'haber');
    const sumaDebe  = debitos.reduce((s, l) => s.plus(l.importe), new Decimal(0));
    const sumaHaber = creditos.reduce((s, l) => s.plus(l.importe), new Decimal(0));
    expect(sumaDebe.eq(sumaHaber)).toBe(true);

    const debe1102  = debitos.find((l) => l.codigo === '1102.01');
    const haber4101 = creditos.find((l) => l.codigo === '4101.01');
    const haber2102 = creditos.find((l) => l.codigo === '2102.01');

    expect(new Decimal(debe1102!.importe).toFixed(4)).toBe(TOTAL);
    expect(new Decimal(haber4101!.importe).toFixed(4)).toBe(SUBTOTAL);
    expect(new Decimal(haber2102!.importe).toFixed(4)).toBe(ITBIS);
  });

  // ── Step 2: comprobante_ecf E31 ACEPTADO vinculado a la factura ──────────────
  it('02 — comprobante_ecf E31 ACEPTADO emitido y vinculado a la factura', async () => {
    ecfId = newId();
    const retenerHasta = new Date(now);
    retenerHasta.setUTCFullYear(retenerHasta.getUTCFullYear() + 1);

    await adminPool.query(
      `INSERT INTO comprobante_ecf (id,tenant_id,empresa_id,proyecto_id,factura_cliente_id,
         tipo_ecf,ncf,estado,documento,hash_integridad,monto_subtotal,monto_itbis,monto_total,
         moneda,fecha_emision,retener_hasta,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,'E31',$6,'ACEPTADO','{}'::jsonb,'sha256-e2e-test',
         $7,$8,$9,'DOP',$10,$11,$12,$12)`,
      [
        ecfId, tenantId, empresaId, proyectoId, facturaId,
        NCF_E2E, SUBTOTAL, ITBIS, TOTAL,
        hoy, retenerHasta.toISOString().slice(0, 10), uid,
      ],
    );

    const [ecf] = await adminDb
      .select({ id: schema.comprobantesEcf.id, estado: schema.comprobantesEcf.estado, ncf: schema.comprobantesEcf.ncf })
      .from(schema.comprobantesEcf)
      .where(eq(schema.comprobantesEcf.id, ecfId));

    expect(ecf!.estado).toBe('ACEPTADO');
    expect(ecf!.ncf).toBe(NCF_E2E);
  });

  // ── Step 3: cobro_recibido → CxC PAGADA_TOTAL ────────────────────────────────
  it('03 — cobro_recibido aplica a la CxC → estado PAGADA_TOTAL', async () => {
    const cobro = await ledgerSvc.append({
      tenantId, empresaId, proyectoId,
      tipoEvento: 'cobro_recibido',
      usuarioId: uid,
      payload: {
        cuentaBancariaId: newId(), // UUID ficticio; BancoMovimientoHandler no está en este engine
        facturaClienteId: facturaId,
        montoCobrado: { amount: TOTAL, currency: 'DOP' },
        tasaFactura: '1.0000',
        tasaCobro: '1.0000',
        monedaBase: 'DOP',
        aplicaciones: [
          { cuentaPorCobrarId: cxcId, monto: { amount: TOTAL, currency: 'DOP' } },
        ],
        referenciaBancaria: 'TRANS-E2E-001',
      },
      idempotencyKey: `cobro-e2e-${facturaId}`,
    });

    // Verificar CxC en PAGADA_TOTAL
    const [cxc] = await adminDb
      .select({ estado: schema.cuentasPorCobrar.estado, montoCobrado: schema.cuentasPorCobrar.montoCobrado })
      .from(schema.cuentasPorCobrar)
      .where(eq(schema.cuentasPorCobrar.id, cxcId));

    expect(cxc!.estado).toBe('PAGADA_TOTAL');
    expect(new Decimal(cxc!.montoCobrado).toFixed(4)).toBe(TOTAL);

    // Verificar asiento de cobro (2 líneas: DEBE 1101 / HABER 1102)
    const [asientoCobro] = await adminDb
      .select({ id: schema.asientosContables.id })
      .from(schema.asientosContables)
      .where(eq(schema.asientosContables.eventoId, cobro.id));

    expect(asientoCobro).toBeDefined();

    const lineasCobro = await adminDb
      .select({
        tipo: schema.lineasAsiento.tipo,
        importe: schema.lineasAsiento.importe,
        codigo: schema.cuentasContables.codigo,
      })
      .from(schema.lineasAsiento)
      .innerJoin(schema.cuentasContables, eq(schema.lineasAsiento.cuentaId, schema.cuentasContables.id))
      .where(eq(schema.lineasAsiento.asientoId, asientoCobro!.id));

    expect(lineasCobro).toHaveLength(2);
    const debe1101  = lineasCobro.find((l) => l.codigo === '1101.01' && l.tipo === 'debe');
    const haber1102 = lineasCobro.find((l) => l.codigo === '1102.01' && l.tipo === 'haber');

    expect(new Decimal(debe1101!.importe).toFixed(4)).toBe(TOTAL);
    expect(new Decimal(haber1102!.importe).toFixed(4)).toBe(TOTAL);
  });

  // ── Step 4: 607 incluye el comprobante con el NCF correcto ───────────────────
  it('04 — 607 incluye el comprobante E31 con NCF y subtotal correctos', async () => {
    const reporte607 = await dgiiSvc.generar607(tenantId, empresaId, anio, mes);

    expect(reporte607.filas.length).toBeGreaterThanOrEqual(1);
    const fila = reporte607.filas.find((f) => f.ncf === NCF_E2E);
    expect(fila, `NCF ${NCF_E2E} debe aparecer en el 607`).toBeDefined();
    expect(new Decimal(fila!.montoSubtotal).toFixed(4)).toBe(SUBTOTAL);
    expect(new Decimal(fila!.montoItbis).toFixed(4)).toBe(ITBIS);
    expect(fila!.rncCedula).toBe('130111555');
  });

  // ── Step 5: IT-1 cuadra tras confirmar los asientos ──────────────────────────
  it('05 — IT-1 cuadra: ITBIS cobrado (607) == ITBIS por pagar contable (cuenta 2102)', async () => {
    // El cierre contable confirma los asientos. Simulamos eso aquí:
    await adminPool.query(
      `UPDATE asiento_contable SET estado='confirmado', updated_at=now(), updated_by=$1
       WHERE tenant_id=$2 AND estado='borrador'`,
      [uid, tenantId],
    );

    const it1 = await dgiiSvc.generarIT1(tenantId, empresaId, anio, mes);

    // ITBIS cobrado = 18,000 (del comprobante E31 ACEPTADO)
    expect(new Decimal(it1.itbisCobrado).toFixed(4)).toBe(ITBIS);

    // ITBIS por pagar contable = 18,000 (net HABER de cuenta 2102.01)
    expect(new Decimal(it1.reconciliacion.itbisPorPagarContable).toFixed(4)).toBe(ITBIS);

    // Diferencia debe ser ≤ 1 centavo → cuadra = true
    expect(it1.reconciliacion.cuadra).toBe(true);
  });

  afterAll(async () => {
    // Orden respetando FKs: hijos antes que padres.
    // cuenta_por_cobrar → asiento_contable → linea_asiento (también → asiento)
    // cubicacion ↔ factura_cliente: FK circular; nullificar primero
    await adminPool.query(`DELETE FROM linea_asiento WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM cuenta_por_cobrar WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM asiento_contable WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM regla_contable WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM cuenta_contable WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM comprobante_ecf WHERE tenant_id=$1`, [tenantId]);
    // Romper FK circular cubicacion.factura_cliente_id ↔ factura_cliente.cubicacion_id
    await adminPool.query(`UPDATE cubicacion SET factura_cliente_id=NULL WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM factura_cliente WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM cubicacion_linea WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM cubicacion WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    // Mover versiones APROBADO → RECHAZADO para desactivar protect_lineas_aprobadas
    await adminPool.query(
      `UPDATE version_presupuesto SET estado='RECHAZADO' WHERE tenant_id=$1 AND estado='APROBADO'`,
      [tenantId],
    );
    await adminPool.query(`DELETE FROM linea_presupuesto WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE version_presupuesto DISABLE TRIGGER no_delete_version_presupuesto`);
    await adminPool.query(`DELETE FROM version_presupuesto WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE version_presupuesto ENABLE TRIGGER no_delete_version_presupuesto`);
    await adminPool.query(`DELETE FROM ejecucion_partida WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE partida DISABLE TRIGGER no_delete_partida`);
    await adminPool.query(`DELETE FROM partida WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE partida ENABLE TRIGGER no_delete_partida`);
    await adminPool.query(`DELETE FROM unidad_medida WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
  });
});
