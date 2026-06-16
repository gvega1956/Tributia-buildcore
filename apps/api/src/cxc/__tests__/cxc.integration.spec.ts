/**
 * PRUEBAS DE INTEGRACIÓN — CxC y Cubicaciones: facturación de avance (Sesión 3 Capa 2, §16)
 *
 *  01. Cubicación dentro del avance aprobado se emite con retención de garantía correcta.
 *  02. Cubicación que supera el avance acumulado aprobado → UnprocessableEntityException.
 *  03. Segunda cubicación (otra partida) dentro de su propio avance aprobado.
 *  04. RetencionClienteService: cliente Estado → ISR 5% + ITBIS 100% (catálogo DGII).
 *  05. RetencionClienteService: cliente privado → sin retención.
 *  06. emision_factura_cliente (cliente Estado) → asiento de 5 líneas balanceado + CxC neta.
 *  07. emision_factura_cliente (cliente privado) → asiento de 3 líneas (retenciones cero omitidas) + CxC.
 *  08. Rechaza facturar de nuevo una cubicación ya facturada.
 *  09. AgingService.porCliente clasifica saldos pendientes en los tramos correctos.
 *  10. AgingService.porProyecto agrupa por proyecto y clasifica tramos correctamente.
 *  11. RLS: tenant2 no ve cubicaciones, facturas ni CxC de tenant1.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
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
import { CubicacionService } from '../cubicacion.service.js';
import { FacturaClienteService } from '../factura-cliente.service.js';
import { RetencionClienteService } from '../retencion-cliente.service.js';
import { CuentaPorCobrarService } from '../cuenta-por-cobrar.service.js';
import { AgingService } from '../aging.service.js';

// ─── Conexiones ───────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';
const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('CxC / Cubicaciones — facturación de avance', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  // ── Fixtures ─────────────────────────────────────────────────────────────
  let tenantId: string;
  let t2: string;
  let empresaId: string;
  let e2: string;
  let proyectoId: string;
  let proyecto2Id: string;
  let clienteEstadoId: string;
  let clientePrivadoId: string;
  let unidadId: string;
  let partida1Id: string;
  let partida2Id: string;
  let versionBaseId: string;

  let cubicacion1Id: string;
  let cubicacion2Id: string;
  let factura1Id: string;

  // Servicios bajo prueba
  let cubicacionSvc: CubicacionService;
  let facturaSvc: FacturaClienteService;
  let retencionSvc: RetencionClienteService;
  let cxcSvc: CuentaPorCobrarService;
  let agingSvc: AgingService;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool = new Pool({ connectionString: APP_URL });
    adminDb = drizzle(adminPool, { schema });

    tenantId = newId();
    t2 = newId();
    empresaId = newId();
    e2 = newId();
    proyectoId = newId();
    proyecto2Id = newId();
    clienteEstadoId = newId();
    clientePrivadoId = newId();
    unidadId = newId();
    partida1Id = newId();
    partida2Id = newId();
    versionBaseId = newId();

    const uid = SYSTEM_USER_ID;
    const now = new Date();

    // ── Tenants ──────────────────────────────────────────────────────────────
    await adminDb.insert(schema.tenants).values([
      { id: tenantId, nombre: 'T-CxC', slug: `cxc-t1-${tenantId.slice(-12)}`, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
      { id: t2, nombre: 'T-CxC-2', slug: `cxc-t2-${t2.slice(-12)}`, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);

    // ── Empresas ─────────────────────────────────────────────────────────────
    await adminDb.insert(schema.empresas).values([
      { id: empresaId, tenantId, nombre: 'Empresa CxC Test', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
      { id: e2, tenantId: t2, nombre: 'Empresa CxC Test 2', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);

    // ── Terceros (clientes) ──────────────────────────────────────────────────
    await adminDb.insert(schema.terceros).values([
      {
        id: clienteEstadoId, tenantId, tipoIdentificacion: 'RNC', rncCedula: '401000001',
        nombreComercial: 'Ministerio de Obras [test]', tipoContribuyente: 'ENTIDAD_GUBERNAMENTAL',
        condicionDgii: 'NORMAL', esCliente: true, esInstitucionEstatal: true,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: clientePrivadoId, tenantId, tipoIdentificacion: 'RNC', rncCedula: '101000002',
        nombreComercial: 'Cliente Privado SA [test]', tipoContribuyente: 'PERSONA_JURIDICA',
        condicionDgii: 'NORMAL', esCliente: true, esInstitucionEstatal: false,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // ── Proyectos (retencionGarantiaPct 5%) ────────────────────────────────────
    await adminDb.insert(schema.proyectos).values([
      {
        id: proyectoId, tenantId, empresaId, clienteId: clienteEstadoId,
        nombre: 'Proyecto CxC 1', codigo: 'PRY-CXC-1', estado: 'EN_EJECUCION',
        monedaContrato: 'DOP', montoContrato: '5000000.0000', tipoObra: 'OTRO',
        presupuestoVigenteMonto: '0.0000', retencionGarantiaPct: '5.00',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: proyecto2Id, tenantId, empresaId, clienteId: clientePrivadoId,
        nombre: 'Proyecto CxC 2', codigo: 'PRY-CXC-2', estado: 'EN_EJECUCION',
        monedaContrato: 'DOP', montoContrato: '1000000.0000', tipoObra: 'OTRO',
        presupuestoVigenteMonto: '0.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // ── Unidad de medida ─────────────────────────────────────────────────────
    await adminDb.insert(schema.unidadesMedida).values([{
      id: unidadId, tenantId, codigo: 'M3CXC', nombre: 'Metro cúbico CxC',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Partidas (proyecto 1) ────────────────────────────────────────────────
    await adminDb.insert(schema.partidas).values([
      {
        id: partida1Id, tenantId, proyectoId, nivel: 2, orden: 1, numeroJerarquico: '1.1',
        codigo: 'PAR-CXC-001', nombre: 'Hormigón CxC', unidadMedidaId: unidadId,
        cantidadPresupuestada: '100.0000', precioUnitario: '1000.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: partida2Id, tenantId, proyectoId, nivel: 2, orden: 2, numeroJerarquico: '1.2',
        codigo: 'PAR-CXC-002', nombre: 'Acero CxC', unidadMedidaId: unidadId,
        cantidadPresupuestada: '50.0000', precioUnitario: '2000.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // ── Presupuesto BASE aprobado (precio contractual de facturación) ─────────
    await adminDb.insert(schema.versionesPresupuesto).values([{
      id: versionBaseId, tenantId, proyectoId, nombre: 'Presupuesto Base CxC', tipo: 'BASE',
      estado: 'PENDIENTE', moneda: 'DOP', totalDirecto: '5000000.0000', totalIndirecto: '0.0000',
      totalPresupuesto: '5000000.0000', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.lineasPresupuesto).values([
      {
        id: newId(), tenantId, versionPresupuestoId: versionBaseId, partidaId: partida1Id,
        cantidad: '100.0000', precioUnitario: '1000.0000', total: '100000.0000', moneda: 'DOP',
        esIndirecto: false, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
      {
        id: newId(), tenantId, versionPresupuestoId: versionBaseId, partidaId: partida2Id,
        cantidad: '50.0000', precioUnitario: '2000.0000', total: '100000.0000', moneda: 'DOP',
        esIndirecto: false, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    await adminPool.query(
      `UPDATE version_presupuesto SET estado = 'APROBADO', aprobado_por = $1, aprobado_en = now(),
       updated_at = now(), updated_by = $1 WHERE id = $2`,
      [uid, versionBaseId],
    );

    // ── ejecucion_partida: avance físico APROBADO (ADR-0006) ──────────────────
    await adminPool.query(
      `INSERT INTO ejecucion_partida (id, tenant_id, partida_id, avance_cantidad, moneda, ultima_actualizacion, created_by, updated_by)
       VALUES ($1,$2,$3,'60.0000','DOP',now(),$4,$4)`,
      [newId(), tenantId, partida1Id, uid],
    );
    await adminPool.query(
      `INSERT INTO ejecucion_partida (id, tenant_id, partida_id, avance_cantidad, moneda, ultima_actualizacion, created_by, updated_by)
       VALUES ($1,$2,$3,'20.0000','DOP',now(),$4,$4)`,
      [newId(), tenantId, partida2Id, uid],
    );

    // ── Plan de cuentas mínimo para emision_factura_cliente ────────────────────
    const cuentas: Array<[string, string, string, string]> = [
      ['1102.01', 'Cuentas por Cobrar Clientes', 'activo', 'deudora'],
      ['1105.01', 'ISR Retenido por Clientes 5%', 'activo', 'deudora'],
      ['1105.02', 'ITBIS Retenido por Clientes', 'activo', 'deudora'],
      ['4101.01', 'Ingreso por Avance de Obra', 'ingreso', 'acreedora'],
      ['2103.01', 'ITBIS por Pagar', 'pasivo', 'acreedora'],
    ];
    for (const [codigo, nombre, tipo, naturaleza] of cuentas) {
      await adminPool.query(
        `INSERT INTO cuenta_contable (id, tenant_id, empresa_id, codigo, nombre, tipo, naturaleza, nivel, es_movimiento, activo, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,4,true,true,$8,$8)`,
        [newId(), tenantId, empresaId, codigo, nombre, tipo, naturaleza, uid],
      );
    }

    // ── Regla contable REQUERIDA para emision_factura_cliente ─────────────────
    const reglaCfg: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito', cuentaCodigo: '1102.01', descripcion: 'CxC neto a cobrar', montoKey: 'netoACobrar' },
        { tipo: 'debito', cuentaCodigo: '1105.01', descripcion: 'ISR retenido por el cliente', montoKey: 'retencionIsr' },
        { tipo: 'debito', cuentaCodigo: '1105.02', descripcion: 'ITBIS retenido por el cliente', montoKey: 'retencionItbis' },
        { tipo: 'credito', cuentaCodigo: '4101.01', descripcion: 'Ingreso por avance de obra', montoKey: 'subtotal' },
        { tipo: 'credito', cuentaCodigo: '2103.01', descripcion: 'ITBIS por pagar', montoKey: 'itbis' },
      ],
    };
    await adminPool.query(
      `INSERT INTO regla_contable (id, tenant_id, empresa_id, tipo_evento, nombre, configuracion, prioridad, activo, created_by, updated_by)
       VALUES ($1,$2,$3,'emision_factura_cliente','Factura cliente CxC test',$4::jsonb,0,true,$5,$5)`,
      [newId(), tenantId, empresaId, JSON.stringify(reglaCfg), uid],
    );

    // ── Catálogo DGII de retenciones (tabla de sistema, sin tenant) ───────────
    await adminPool.query(
      `INSERT INTO tipo_retencion (id, codigo, nombre, porcentaje, aplica_a, descripcion, valido_desde, activo)
       VALUES ($1,'ISR_ESTADO_5PCT','ISR Pagos del Estado 5%','5.00','AMBOS','Retención 5% del Estado','2020-01-01',true)
       ON CONFLICT (codigo) DO NOTHING`,
      [newId()],
    );
    await adminPool.query(
      `INSERT INTO tipo_retencion (id, codigo, nombre, porcentaje, aplica_a, descripcion, valido_desde, activo)
       VALUES ($1,'ITBIS_SERVICIOS_GOB_100','Retención ITBIS Gobierno 100%','100.00','SERVICIOS','Retención total ITBIS gobierno','2020-01-01',true)
       ON CONFLICT (codigo) DO NOTHING`,
      [newId()],
    );

    // ── Servicios bajo prueba (wiring manual, sin contenedor Nest) ─────────────
    const dbSvc = { tx: adminDb } as unknown as DbService;

    const realReglaSvc = new ReglaContableService();
    const cuentaSvc = new CuentaContableService(null as never);
    const realAsientoSvc = new AsientoContableService(null as never, cuentaSvc);
    const cxcHandler = new CxcEmisionFacturaClienteHandler(realReglaSvc, realAsientoSvc);

    const projEngine = new ProjectionEngineService([cxcHandler], dbSvc);
    const ledgerSvc = new LedgerService(dbSvc, projEngine);

    cubicacionSvc = new CubicacionService(dbSvc);
    retencionSvc = new RetencionClienteService();
    facturaSvc = new FacturaClienteService(dbSvc, ledgerSvc, retencionSvc);
    cxcSvc = new CuentaPorCobrarService(dbSvc);
    agingSvc = new AgingService(dbSvc);
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM cuenta_por_cobrar WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`UPDATE cubicacion SET factura_cliente_id = NULL WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM factura_cliente WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM cubicacion_linea WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM cubicacion WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);

    await adminPool.query(`DELETE FROM linea_asiento WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM asiento_contable WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM regla_contable WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM cuenta_contable WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);

    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);

    await adminPool.query(`DELETE FROM ejecucion_partida WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);

    await adminPool.query(`ALTER TABLE linea_presupuesto DISABLE TRIGGER protect_lineas_aprobadas`);
    await adminPool.query(`DELETE FROM linea_presupuesto WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE linea_presupuesto ENABLE TRIGGER protect_lineas_aprobadas`);

    await adminPool.query(`ALTER TABLE version_presupuesto DISABLE TRIGGER no_delete_version_presupuesto`);
    await adminPool.query(`DELETE FROM version_presupuesto WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE version_presupuesto ENABLE TRIGGER no_delete_version_presupuesto`);

    await adminPool.query(`ALTER TABLE partida DISABLE TRIGGER no_delete_partida`);
    await adminPool.query(`DELETE FROM partida WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE partida ENABLE TRIGGER no_delete_partida`);

    await adminPool.query(`DELETE FROM unidad_medida WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);

    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);

    await adminPool.query(`DELETE FROM tercero WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);

    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);

    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);

    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);

    await adminPool.end();
    await appPool.end();
  });

  // ── TEST 01: Cubicación dentro del avance aprobado ────────────────────────
  it('01. Crea cubicación dentro del avance aprobado con retención de garantía correcta', async () => {
    const cubicacion = await cubicacionSvc.crear(
      tenantId,
      { empresaId, proyectoId, fechaCorte: '2026-06-01', lineas: [{ partidaId: partida1Id, cantidadPeriodo: '40.0000' }] },
      SYSTEM_USER_ID,
    );

    cubicacion1Id = cubicacion.id;
    expect(cubicacion.estado).toBe('EMITIDA');
    expect(cubicacion.montoBruto).toBe('40000.0000');
    expect(cubicacion.montoRetencionGarantia).toBe('2000.0000'); // 5% de 40000
    expect(cubicacion.montoFacturable).toBe('38000.0000');
    expect(cubicacion.lineas[0]!.cantidadAcumulada).toBe('40.0000');
  });

  // ── TEST 02: Tope de avance aprobado ───────────────────────────────────────
  it('02. Rechaza cubicación que excede el avance acumulado aprobado', async () => {
    await expect(
      cubicacionSvc.crear(
        tenantId,
        { empresaId, proyectoId, fechaCorte: '2026-06-15', lineas: [{ partidaId: partida1Id, cantidadPeriodo: '25.0000' }] },
        SYSTEM_USER_ID,
      ),
    ).rejects.toThrow('No se puede facturar más avance del aprobado');
  });

  // ── TEST 03: Segunda cubicación (otra partida) ─────────────────────────────
  it('03. Crea segunda cubicación para partida2 dentro de su propio avance aprobado', async () => {
    const cubicacion = await cubicacionSvc.crear(
      tenantId,
      { empresaId, proyectoId, fechaCorte: '2026-06-01', lineas: [{ partidaId: partida2Id, cantidadPeriodo: '10.0000' }] },
      SYSTEM_USER_ID,
    );

    cubicacion2Id = cubicacion.id;
    expect(cubicacion.montoBruto).toBe('20000.0000');
    expect(cubicacion.montoRetencionGarantia).toBe('1000.0000'); // 5% de 20000
    expect(cubicacion.montoFacturable).toBe('19000.0000');
  });

  // ── TEST 04: Retención del Estado ──────────────────────────────────────────
  it('04. RetencionClienteService calcula ISR 5% e ITBIS 100% para cliente del Estado', async () => {
    const resultado = await retencionSvc.calcular(
      adminDb,
      tenantId,
      clienteEstadoId,
      new Decimal('38000.0000'),
      new Decimal('6840.0000'),
    );

    expect(resultado.esInstitucionEstatal).toBe(true);
    expect(resultado.retencionIsr.toFixed(4)).toBe('1900.0000'); // 5% de 38000
    expect(resultado.retencionItbis.toFixed(4)).toBe('6840.0000'); // 100% de 6840
  });

  // ── TEST 05: Sin retención para cliente privado ────────────────────────────
  it('05. RetencionClienteService no aplica retención a cliente privado', async () => {
    const resultado = await retencionSvc.calcular(
      adminDb,
      tenantId,
      clientePrivadoId,
      new Decimal('19000.0000'),
      new Decimal('3420.0000'),
    );

    expect(resultado.esInstitucionEstatal).toBe(false);
    expect(resultado.retencionIsr.toFixed(4)).toBe('0.0000');
    expect(resultado.retencionItbis.toFixed(4)).toBe('0.0000');
  });

  // ── TEST 06: Asiento exacto — cliente Estado (5 líneas) ────────────────────
  it('06. emision_factura_cliente (cliente Estado) genera el asiento exacto y la CxC neta', async () => {
    const resultado = await facturaSvc.emitir(
      tenantId,
      { cubicacionId: cubicacion1Id, clienteId: clienteEstadoId, numero: 'FC-CXC-001', itbisPct: '18', diasCredito: 30 },
      SYSTEM_USER_ID,
    );

    factura1Id = resultado.id;
    expect(resultado.montoSubtotal).toBe('38000.0000');
    expect(resultado.montoItbis).toBe('6840.0000');
    expect(resultado.montoRetencionIsr).toBe('1900.0000');
    expect(resultado.montoRetencionItbis).toBe('6840.0000');
    expect(resultado.montoTotal).toBe('44840.0000');
    expect(resultado.montoNetoACobrar).toBe('36100.0000');

    const [factura] = await adminDb.select().from(schema.facturasCliente).where(eq(schema.facturasCliente.id, factura1Id));
    expect(factura!.eventoId).not.toBeNull();

    const [asiento] = await adminDb
      .select()
      .from(schema.asientosContables)
      .where(eq(schema.asientosContables.eventoId, factura!.eventoId!));
    expect(asiento).toBeDefined();

    const lineas = await adminDb.select().from(schema.lineasAsiento).where(eq(schema.lineasAsiento.asientoId, asiento!.id));
    expect(lineas).toHaveLength(5);

    const porCuenta = new Map<string, { tipo: string; importe: string }>();
    for (const l of lineas) {
      const [cuenta] = await adminDb.select().from(schema.cuentasContables).where(eq(schema.cuentasContables.id, l.cuentaId));
      porCuenta.set(cuenta!.codigo, { tipo: l.tipo, importe: l.importe });
    }

    expect(porCuenta.get('1102.01')).toEqual({ tipo: 'debe', importe: '36100.0000' });
    expect(porCuenta.get('1105.01')).toEqual({ tipo: 'debe', importe: '1900.0000' });
    expect(porCuenta.get('1105.02')).toEqual({ tipo: 'debe', importe: '6840.0000' });
    expect(porCuenta.get('4101.01')).toEqual({ tipo: 'haber', importe: '38000.0000' });
    expect(porCuenta.get('2103.01')).toEqual({ tipo: 'haber', importe: '6840.0000' });

    const debe = lineas.filter((l) => l.tipo === 'debe').reduce((s, l) => s.plus(l.importe), new Decimal(0));
    const haber = lineas.filter((l) => l.tipo === 'haber').reduce((s, l) => s.plus(l.importe), new Decimal(0));
    expect(debe.toFixed(4)).toBe(haber.toFixed(4));
    expect(debe.toFixed(4)).toBe('44840.0000');

    const [cxc] = await adminDb.select().from(schema.cuentasPorCobrar).where(eq(schema.cuentasPorCobrar.facturaClienteId, factura1Id));
    expect(cxc!.montoOriginal).toBe('36100.0000');
    expect(cxc!.estado).toBe('PENDIENTE');
    expect(cxc!.fechaVencimiento).not.toBeNull();
  });

  // ── TEST 07: Asiento exacto — cliente privado (3 líneas) ───────────────────
  it('07. emision_factura_cliente (cliente privado) omite líneas de retención cero', async () => {
    const resultado = await facturaSvc.emitir(
      tenantId,
      { cubicacionId: cubicacion2Id, clienteId: clientePrivadoId, numero: 'FC-CXC-002', itbisPct: '18', diasCredito: 30 },
      SYSTEM_USER_ID,
    );

    expect(resultado.montoSubtotal).toBe('19000.0000');
    expect(resultado.montoItbis).toBe('3420.0000');
    expect(resultado.montoRetencionIsr).toBe('0.0000');
    expect(resultado.montoRetencionItbis).toBe('0.0000');
    expect(resultado.montoTotal).toBe('22420.0000');
    expect(resultado.montoNetoACobrar).toBe('22420.0000');

    const [factura] = await adminDb.select().from(schema.facturasCliente).where(eq(schema.facturasCliente.id, resultado.id));
    const [asiento] = await adminDb.select().from(schema.asientosContables).where(eq(schema.asientosContables.eventoId, factura!.eventoId!));
    const lineas = await adminDb.select().from(schema.lineasAsiento).where(eq(schema.lineasAsiento.asientoId, asiento!.id));

    expect(lineas).toHaveLength(3);
    const debe = lineas.filter((l) => l.tipo === 'debe').reduce((s, l) => s.plus(l.importe), new Decimal(0));
    const haber = lineas.filter((l) => l.tipo === 'haber').reduce((s, l) => s.plus(l.importe), new Decimal(0));
    expect(debe.toFixed(4)).toBe(haber.toFixed(4));
    expect(debe.toFixed(4)).toBe('22420.0000');

    const [cxc] = await adminDb.select().from(schema.cuentasPorCobrar).where(eq(schema.cuentasPorCobrar.facturaClienteId, resultado.id));
    expect(cxc!.montoOriginal).toBe('22420.0000');
  });

  // ── TEST 08: No se puede facturar dos veces la misma cubicación ───────────
  it('08. Rechaza facturar de nuevo una cubicación ya facturada', async () => {
    await expect(
      facturaSvc.emitir(
        tenantId,
        { cubicacionId: cubicacion1Id, clienteId: clienteEstadoId, numero: 'FC-CXC-003', itbisPct: '18', diasCredito: 30 },
        SYSTEM_USER_ID,
      ),
    ).rejects.toThrow('ya fue facturada');
  });

  // ── TEST 09: Aging por cliente ─────────────────────────────────────────────
  it('09. AgingService.porCliente clasifica saldos pendientes en los tramos correctos', async () => {
    const asOf = new Date('2026-07-01T00:00:00Z');

    // CxC sintéticas en distintos tramos, todas del cliente Estado / proyecto 1.
    const synthCubicacionId = newId();
    await adminPool.query(
      `INSERT INTO cubicacion (id, tenant_id, empresa_id, proyecto_id, numero, fecha_corte, monto_bruto, monto_facturable, moneda, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,999,'2026-06-01','1000.0000','1000.0000','DOP','EMITIDA',$5,$5)`,
      [synthCubicacionId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID],
    );
    const synthFacturaId = newId();
    const synthEventoId = newId();
    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'emision_factura_cliente',$5,'{}'::jsonb,$6,$5)`,
      [synthEventoId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID, `aging-synth-${synthEventoId}`],
    );
    await adminPool.query(
      `INSERT INTO factura_cliente (id, tenant_id, empresa_id, proyecto_id, cliente_id, cubicacion_id, numero, fecha_emision, monto_subtotal, monto_total, monto_neto_a_cobrar, estado, evento_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'FC-SYNTH-AGING','2026-06-01','1000.0000','1000.0000','1000.0000','EMITIDA',$7,$8,$8)`,
      [synthFacturaId, tenantId, empresaId, proyectoId, clienteEstadoId, synthCubicacionId, synthEventoId, SYSTEM_USER_ID],
    );

    const tramos: Array<[string, number]> = [
      ['CORRIENTE', 5],
      ['1-30', -11],
      ['31-60', -42],
      ['61-90', -72],
      ['90+', -120],
    ];
    for (const [, offset] of tramos) {
      await adminPool.query(
        `INSERT INTO cuenta_por_cobrar (id, tenant_id, empresa_id, proyecto_id, factura_cliente_id, tercero_id, monto_original, monto_cobrado, fecha_emision, fecha_vencimiento, estado, evento_origen_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,'1000.0000','0.0000','2026-06-01',$7,'PENDIENTE',$8,$9,$9)`,
        [newId(), tenantId, empresaId, proyectoId, synthFacturaId, clienteEstadoId, addDays(asOf, offset), synthEventoId, SYSTEM_USER_ID],
      );
    }

    const grupos = await agingSvc.porCliente(tenantId, asOf);
    const grupoCliente = grupos.find((g) => g.clave === clienteEstadoId);
    expect(grupoCliente).toBeDefined();

    // La CxC real de la factura 1 (36100.0000, test 06) aún no vence (fechaVencimiento
    // = hoy + 30 días, siempre posterior a asOf en este escenario) y cae en CORRIENTE
    // junto con la sintética de ese tramo.
    for (const [tramo] of tramos) {
      const esperado = tramo === 'CORRIENTE' ? '37100.0000' : '1000.0000';
      expect(grupoCliente!.tramos[tramo as keyof typeof grupoCliente.tramos]).toBe(esperado);
    }
    // Las 5 sintéticas + la CxC real de la factura 1 (36100.0000) emitida en test 06.
    expect(grupoCliente!.saldoPendiente).toBe('41100.0000');
  });

  // ── TEST 10: Aging por proyecto ────────────────────────────────────────────
  it('10. AgingService.porProyecto agrupa por proyecto y clasifica tramos correctamente', async () => {
    const asOf = new Date('2026-07-01T00:00:00Z');
    const grupos = await agingSvc.porProyecto(tenantId, asOf);

    const grupoProyecto1 = grupos.find((g) => g.clave === proyectoId);
    expect(grupoProyecto1).toBeDefined();
    expect(grupoProyecto1!.tramos['1-30']).toBe('1000.0000');
    expect(grupoProyecto1!.tramos['90+']).toBe('1000.0000');

    // CxC de la factura 2 (proyecto 1, cliente privado) está en CORRIENTE (vence en ~30 días).
    expect(new Decimal(grupoProyecto1!.tramos['CORRIENTE']).gte('22000')).toBe(true);
  });

  // ── TEST 11: RLS ────────────────────────────────────────────────────────────
  it('11. RLS: tenant2 no ve cubicaciones, facturas ni CxC de tenant1', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${t2}'`);

      const { rows: cubRows } = await client.query(`SELECT id FROM cubicacion WHERE tenant_id = $1`, [tenantId]);
      expect(cubRows.length).toBe(0);

      const { rows: factRows } = await client.query(`SELECT id FROM factura_cliente WHERE tenant_id = $1`, [tenantId]);
      expect(factRows.length).toBe(0);

      const { rows: cxcRows } = await client.query(`SELECT id FROM cuenta_por_cobrar WHERE tenant_id = $1`, [tenantId]);
      expect(cxcRows.length).toBe(0);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // CuentaPorCobrarService también filtra por tenant a nivel de aplicación.
    const lista = await cxcSvc.listar(t2);
    expect(lista).toHaveLength(0);
  });
});
