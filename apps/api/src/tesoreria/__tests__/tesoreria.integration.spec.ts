/**
 * PRUEBAS DE INTEGRACIÓN — Tesorería: bancos, cobros, caja chica, pagos (Sesión 5 Capa 2, §16)
 *
 *  01. Conciliación automática: linea con mismo monto+fecha queda CONCILIADA; la otra DIFERENCIA.
 *  02. Cobro recibido: asiento DEBE Banco / HABER CxC generado con monto exacto.
 *  03. Cobro recibido: CxC.monto_cobrado reducido correctamente (saldo parcial → PAGADA_PARCIAL).
 *  04. Cobro recibido: saldo_actual de cuenta_bancaria incrementado correctamente.
 *  05. Cobro recibido: movimiento_bancario DEPOSITO creado automáticamente.
 *  06. Reposición caja chica: sin instancia de flujo → ConflictException.
 *  07. Reposición caja chica: con workflow APROBADO → evento emitido + fondo repuesto.
 *  08. Pago sin caja suficiente → programacion_pago queda en EN_ESPERA.
 *  09. Asiento cobro_recibido: Σdebe = Σhaber.
 *  10. Conciliación manual: asigna movimiento e ignora línea.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { ConflictException } from '@nestjs/common';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import type { ConfiguracionRegla } from '@tributia/contabilidad';
import { DbService } from '../../database/db.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { ProjectionEngineService } from '../../ledger/projection-engine.service.js';
import { ReglaContableService } from '../../contabilidad/regla-contable.service.js';
import { CuentaContableService } from '../../contabilidad/cuenta-contable.service.js';
import { AsientoContableService } from '../../contabilidad/asiento-contable.service.js';
import { ContabilidadCobroRecibidoHandler } from '../../contabilidad/handlers/contabilidad-cobro-recibido.handler.js';
import { ContabilidadDiferenciaCambiariaHandler } from '../../contabilidad/handlers/contabilidad-diferencia-cambiaria.handler.js';
import { BancoMovimientoHandler } from '../handlers/banco-movimiento.handler.js';
import { ConciliacionBancariaService } from '../conciliacion.service.js';
import { CobroService } from '../cobro.service.js';
import { ReposicionCajaChicaService } from '../reposicion.service.js';
import { ProgramacionPagoService } from '../programacion-pago.service.js';
import { WorkflowService } from '../../workflow/workflow.service.js';
import { TipoFlujoService } from '../../workflow/tipo-flujo.service.js';

// ─── Conexiones ───────────────────────────────────────────────────────────────

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

describe('Tesorería — bancos, cobros, caja chica, pagos (Sesión 5 Capa 2)', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  // ── Fixtures ─────────────────────────────────────────────────────────────────
  let tenantId: string;
  let empresaId: string;
  let proyectoId: string;
  let terceroId: string;
  let usuarioId: string;
  let cuentaBancariaId: string;
  let cuentaPorCobrarId: string;
  let fondoCajaChicaId: string;
  let cuentaPorPagarId: string;

  // ── Servicios ─────────────────────────────────────────────────────────────────
  let conciliacionSvc: ConciliacionBancariaService;
  let cobroSvc: CobroService;
  let reposicionSvc: ReposicionCajaChicaService;
  let programacionSvc: ProgramacionPagoService;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb = drizzle(adminPool, { schema });

    const uid = SYSTEM_USER_ID;
    const now = new Date();

    tenantId          = newId();
    empresaId         = newId();
    proyectoId        = newId();
    terceroId         = newId();
    usuarioId         = newId();
    cuentaBancariaId  = newId();
    cuentaPorCobrarId = newId();
    fondoCajaChicaId  = newId();
    cuentaPorPagarId  = newId();

    // ── Tenant + Empresa ───────────────────────────────────────────────────────
    await adminDb.insert(schema.tenants).values([{
      id: tenantId, nombre: 'Tesorería Test', slug: `tes-${tenantId.slice(-12)}`,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);
    await adminDb.insert(schema.empresas).values([{
      id: empresaId, tenantId, nombre: 'Empresa Tes Test',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Usuario de prueba (FK fondo_caja_chica.responsable_id → usuario.id) ──────
    await adminPool.query(
      `INSERT INTO usuario (id,tenant_id,email,password_hash,nombre,apellido,created_by,updated_by)
       VALUES ($1,$2,'resp.tes@test.com','$2b$10$XXXhash','Responsable','Test',$3,$3)`,
      [usuarioId, tenantId, uid],
    );

    // ── Tercero ANTES que proyecto (FK proyecto.cliente_id → tercero.id) ───────
    await adminDb.insert(schema.terceros).values([{
      id: terceroId, tenantId, tipoIdentificacion: 'RNC', rncCedula: '101999001',
      nombreComercial: 'Tercero Tesorería [test]', tipoContribuyente: 'PERSONA_JURIDICA',
      condicionDgii: 'NORMAL', esCliente: true, esProveedor: true, esInstitucionEstatal: false,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Proyecto ───────────────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO proyecto (id,tenant_id,empresa_id,nombre,codigo,estado,tipo_obra,cliente_id,moneda_contrato,monto_contrato,presupuesto_vigente_monto,created_by,updated_by)
       VALUES ($1,$2,$3,'Proyecto Tes','PRY-TES','EN_EJECUCION','OTRO',$4,'DOP','1000000.0000','0.0000',$5,$5)`,
      [proyectoId, tenantId, empresaId, terceroId, uid],
    );

    // ── Cuenta bancaria ────────────────────────────────────────────────────────
    await adminDb.insert(schema.cuentasBancarias).values([{
      id: cuentaBancariaId, tenantId, empresaId,
      bancoNombre: 'Banco Popular Test', numeroCuenta: '110-999-9900001',
      tipoCuenta: 'CORRIENTE', moneda: 'DOP', cuentaContableCodigo: '1101.01',
      saldoActual: '50000.0000', activo: true,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Cuentas contables mínimas ──────────────────────────────────────────────
    const cuentas: Array<[string, string, string, string]> = [
      ['1101.01', 'Banco Popular Test',     'activo', 'deudora'],
      ['1201.01', 'Cuentas por Cobrar CxC', 'activo', 'deudora'],
    ];
    for (const [codigo, nombre, tipo, naturaleza] of cuentas) {
      await adminPool.query(
        `INSERT INTO cuenta_contable (id,tenant_id,empresa_id,codigo,nombre,tipo,naturaleza,nivel,es_movimiento,activo,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,4,true,true,$8,$8)`,
        [newId(), tenantId, empresaId, codigo, nombre, tipo, naturaleza, uid],
      );
    }

    // ── Regla contable para cobro_recibido ─────────────────────────────────────
    const reglaCobroCfg: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito',  cuentaCodigo: '1101.01', descripcion: 'Banco — cobro recibido' },
        { tipo: 'credito', cuentaCodigo: '1201.01', descripcion: 'Cancela CxC cobrada' },
      ],
    };
    await adminPool.query(
      `INSERT INTO regla_contable (id,tenant_id,empresa_id,tipo_evento,nombre,configuracion,prioridad,activo,created_by,updated_by)
       VALUES ($1,$2,$3,'cobro_recibido','Cobro recibido test',$4::jsonb,0,true,$5,$5)`,
      [newId(), tenantId, empresaId, JSON.stringify(reglaCobroCfg), uid],
    );

    // ── Synthetic evento_operativo para fixture CxC ────────────────────────────
    const synthEventoCxCId = newId();
    await adminPool.query(
      `INSERT INTO evento_operativo (id,tenant_id,empresa_id,proyecto_id,tipo_evento,usuario_id,payload,idempotency_key,created_by)
       VALUES ($1,$2,$3,$4,'emision_factura_cliente',$5,'{}'::jsonb,$6,$5)`,
      [synthEventoCxCId, tenantId, empresaId, proyectoId, uid, `synth-cxc-${synthEventoCxCId}`],
    );

    // ── Cubicación + Factura cliente + CxC ────────────────────────────────────
    const cubicacionId = newId();
    await adminPool.query(
      `INSERT INTO cubicacion (id,tenant_id,empresa_id,proyecto_id,numero,fecha_corte,monto_bruto,monto_retencion_garantia,monto_facturable,moneda,estado,created_by,updated_by)
       VALUES ($1,$2,$3,$4,1,'2026-01-10','100000.0000','0.0000','100000.0000','DOP','EMITIDA',$5,$5)`,
      [cubicacionId, tenantId, empresaId, proyectoId, uid],
    );

    const facturaClienteId = newId();
    await adminPool.query(
      `INSERT INTO factura_cliente (id,tenant_id,empresa_id,proyecto_id,cliente_id,cubicacion_id,numero,fecha_emision,monto_subtotal,monto_total,monto_neto_a_cobrar,estado,evento_id,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'FC-TES-001','2026-01-10','100000.0000','100000.0000','100000.0000','EMITIDA',$7,$8,$8)`,
      [facturaClienteId, tenantId, empresaId, proyectoId, terceroId, cubicacionId, synthEventoCxCId, uid],
    );
    await adminPool.query(
      `INSERT INTO cuenta_por_cobrar (id,tenant_id,empresa_id,proyecto_id,factura_cliente_id,tercero_id,monto_original,monto_cobrado,moneda,fecha_emision,estado,evento_origen_id,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'100000.0000','0.0000','DOP','2026-01-10','PENDIENTE',$7,$8,$8)`,
      [cuentaPorCobrarId, tenantId, empresaId, proyectoId, facturaClienteId, terceroId, synthEventoCxCId, uid],
    );

    // ── Fondo de caja chica ────────────────────────────────────────────────────
    await adminDb.insert(schema.fondosCajaChica).values([{
      id: fondoCajaChicaId, tenantId, empresaId, proyectoId,
      responsableId: usuarioId, cuentaBancariaOrigenId: cuentaBancariaId,
      montoAsignado: '5000.0000', saldoDisponible: '5000.0000',
      moneda: 'DOP', estado: 'ACTIVO', activo: true,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Factura proveedor + CxP (fixture para test 08 de pago) ────────────────
    const facturaProveedorId = newId();
    await adminPool.query(
      `INSERT INTO factura_proveedor (id,tenant_id,empresa_id,tercero_id,numero,ncf,fecha_factura,monto_subtotal,monto_total,moneda,created_by,updated_by)
       VALUES ($1,$2,$3,$4,'FP-TES-001','B01TES001','2026-01-05','80000.0000','80000.0000','DOP',$5,$5)`,
      [facturaProveedorId, tenantId, empresaId, terceroId, uid],
    );
    const synthEventoCxPId = newId();
    await adminPool.query(
      `INSERT INTO evento_operativo (id,tenant_id,empresa_id,proyecto_id,tipo_evento,usuario_id,payload,idempotency_key,created_by)
       VALUES ($1,$2,$3,$4,'recepcion_factura_proveedor',$5,'{}'::jsonb,$6,$5)`,
      [synthEventoCxPId, tenantId, empresaId, proyectoId, uid, `synth-cxp-${synthEventoCxPId}`],
    );
    await adminPool.query(
      `UPDATE factura_proveedor SET evento_id=$1 WHERE id=$2`,
      [synthEventoCxPId, facturaProveedorId],
    );
    await adminPool.query(
      `INSERT INTO cuenta_por_pagar (id,tenant_id,empresa_id,factura_proveedor_id,tercero_id,monto_original,monto_pagado,moneda,estado,evento_origen_id,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,'80000.0000','0.0000','DOP','PENDIENTE',$6,$7,$7)`,
      [cuentaPorPagarId, tenantId, empresaId, facturaProveedorId, terceroId, synthEventoCxPId, uid],
    );

    // ── Wiring de servicios (sin contenedor Nest) ──────────────────────────────
    const dbSvc = { tx: adminDb } as unknown as DbService;
    const reglaSvc   = new ReglaContableService();
    const cuentaSvc  = new CuentaContableService(null as never);
    const asientoSvc = new AsientoContableService(null as never, cuentaSvc);

    const cobroHandler     = new ContabilidadCobroRecibidoHandler(reglaSvc, asientoSvc);
    const diferenciaFxHdlr = new ContabilidadDiferenciaCambiariaHandler(reglaSvc, asientoSvc);
    const bancoHdlr        = new BancoMovimientoHandler();

    // No registramos ContabilidadReposicionCajaChicaHandler porque no hay regla configurada;
    // el BancoMovimientoHandler sí maneja reposicion_caja_chica para debitar el banco.
    const projEngine = new ProjectionEngineService([cobroHandler, diferenciaFxHdlr, bancoHdlr], dbSvc);
    const ledgerSvc  = new LedgerService(dbSvc, projEngine);

    conciliacionSvc = new ConciliacionBancariaService(dbSvc);
    cobroSvc        = new CobroService(ledgerSvc);

    const tipoFlujoSvc = new TipoFlujoService(dbSvc);
    const workflowSvc  = new WorkflowService(dbSvc, tipoFlujoSvc);
    reposicionSvc   = new ReposicionCajaChicaService(dbSvc, ledgerSvc, workflowSvc);
    programacionSvc = new ProgramacionPagoService(dbSvc, ledgerSvc);
  });

  afterAll(async () => {
    // Cleanup en orden inverso de FKs, deshabilitando triggers de protección
    await adminPool.query(`DELETE FROM linea_asiento WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM asiento_contable WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM regla_contable WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM cuenta_contable WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM programacion_pago WHERE tenant_id=$1`, [tenantId]);
    // FK circular: movimiento_bancario.linea_extracto_id ↔ linea_extracto.movimiento_bancario_id
    // → romper el ciclo poniendo en NULL antes de borrar
    await adminPool.query(`UPDATE movimiento_bancario SET linea_extracto_id=NULL WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`UPDATE linea_extracto SET movimiento_bancario_id=NULL WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM linea_extracto WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM movimiento_bancario WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM extracto_bancario WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM reposicion_caja_chica WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM gasto_caja_chica WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM fondo_caja_chica WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM cuenta_por_cobrar WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`UPDATE factura_cliente SET evento_id=NULL WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`UPDATE cubicacion SET factura_cliente_id=NULL WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM factura_cliente WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM cubicacion WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE cuenta_por_pagar DISABLE TRIGGER no_delete_cuenta_por_pagar`);
    await adminPool.query(`DELETE FROM cuenta_por_pagar WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE cuenta_por_pagar ENABLE TRIGGER no_delete_cuenta_por_pagar`);
    await adminPool.query(`ALTER TABLE factura_proveedor DISABLE TRIGGER no_delete_factura_proveedor`);
    await adminPool.query(`UPDATE factura_proveedor SET evento_id=NULL WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM factura_proveedor WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE factura_proveedor ENABLE TRIGGER no_delete_factura_proveedor`);
    await adminPool.query(`DELETE FROM aprobacion_paso WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM instancia_flujo WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM paso_flujo WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM tipo_flujo WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM cuenta_bancaria WHERE tenant_id=$1`, [tenantId]);
    // proyecto antes que tercero (FK proyecto.cliente_id → tercero.id)
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE usuario DISABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`DELETE FROM usuario WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE usuario ENABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
  });

  // ─── 01. Conciliación automática: CONCILIADA + DIFERENCIA ───────────────────

  it('01 — conciliación automática: línea que coincide → CONCILIADA, la otra → DIFERENCIA', async () => {
    const uid = SYSTEM_USER_ID;
    const now = new Date();

    // Movimiento que coincidirá con la línea del extracto (misma fecha+monto+tipo)
    const movimientoId = newId();
    await adminDb.insert(schema.movimientosBancarios).values([{
      id: movimientoId, tenantId, empresaId,
      cuentaBancariaId, tipo: 'DEPOSITO',
      monto: '10000.0000', moneda: 'DOP',
      fecha: '2026-01-20', concepto: 'Cobro cliente A',
      conciliado: false, lineaExtractoId: null,
      eventoOrigenId: null,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    const extractoId = await conciliacionSvc.importarExtracto(tenantId, uid, {
      cuentaBancariaId, empresaId,
      periodoDesde: '2026-01-01', periodoHasta: '2026-01-31',
      archivoNombre: 'extracto-enero.csv',
      lineas: [
        { fecha: '2026-01-20', descripcion: 'Cobro cliente A', monto: '10000.0000' },
        { fecha: '2026-01-25', descripcion: 'Nota de cargo banco', monto: '-300.0000' },
      ],
    });

    const resultados = await conciliacionSvc.conciliarAutomatico(tenantId, uid, extractoId);

    expect(resultados).toHaveLength(2);
    const conciliada = resultados.find(r => r.estado === 'CONCILIADA');
    const diferencia = resultados.find(r => r.estado === 'DIFERENCIA');
    expect(conciliada).toBeDefined();
    expect(conciliada!.movimientoBancarioId).toBe(movimientoId);
    expect(diferencia).toBeDefined();
  });

  // ─── 02. Cobro recibido: asiento DEBE Banco / HABER CxC generado ────────────

  it('02 — cobro_recibido → asiento de 2 líneas con montos correctos', async () => {
    const uid = SYSTEM_USER_ID;

    const evento = await cobroSvc.registrarCobro(tenantId, uid, {
      empresaId,
      proyectoId,
      cuentaBancariaId,
      montoCobrado: { amount: '30000.0000', currency: 'DOP' },
      tasaFactura:  '1.000000',
      tasaCobro:    '1.000000',
      monedaBase:   'DOP',
      aplicaciones: [{ cuentaPorCobrarId, monto: { amount: '30000.0000', currency: 'DOP' } }],
    });

    const res = await adminPool.query<{ tipo: string; importe: string; moneda: string }>(
      `SELECT la.tipo, la.importe, la.moneda
       FROM linea_asiento la
       JOIN asiento_contable ac ON ac.id = la.asiento_id
       WHERE ac.evento_id = $1
       ORDER BY la.tipo`,
      [evento.id],
    );

    expect(res.rows).toHaveLength(2);
    const debe  = res.rows.find(r => r.tipo === 'debe')!;
    const haber = res.rows.find(r => r.tipo === 'haber')!;
    expect(parseFloat(debe.importe)).toBeCloseTo(30000, 2);
    expect(parseFloat(haber.importe)).toBeCloseTo(30000, 2);
    expect(debe.moneda).toBe('DOP');
  });

  // ─── 03. Cobro recibido: CxC.monto_cobrado reducido → PAGADA_PARCIAL ─────────

  it('03 — cobro_recibido aplica a CxC → monto_cobrado actualizado, estado PAGADA_PARCIAL', async () => {
    const [cxc] = await adminDb
      .select()
      .from(schema.cuentasPorCobrar)
      .where(eq(schema.cuentasPorCobrar.id, cuentaPorCobrarId));

    // Original era 100000; cobrado 30000 → monto_cobrado = 30000
    expect(new Decimal(cxc!.montoCobrado).toFixed(4)).toBe('30000.0000');
    expect(cxc!.estado).toBe('PAGADA_PARCIAL');
  });

  // ─── 04. Cobro recibido: saldo_actual de cuenta_bancaria incrementado ─────────

  it('04 — cobro_recibido incrementa saldo_actual de la cuenta bancaria', async () => {
    const [cuenta] = await adminDb
      .select()
      .from(schema.cuentasBancarias)
      .where(eq(schema.cuentasBancarias.id, cuentaBancariaId));

    // Saldo inicial 50000 + cobro 30000 = 80000
    expect(new Decimal(cuenta!.saldoActual).toFixed(4)).toBe('80000.0000');
  });

  // ─── 05. Cobro recibido: movimiento_bancario DEPOSITO creado ─────────────────

  it('05 — cobro_recibido crea movimiento_bancario de tipo DEPOSITO', async () => {
    const res = await adminPool.query<{ tipo: string }>(
      `SELECT tipo FROM movimiento_bancario
       WHERE cuenta_bancaria_id=$1 AND tipo='DEPOSITO' AND monto='30000.0000'
       ORDER BY created_at DESC LIMIT 1`,
      [cuentaBancariaId],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.tipo).toBe('DEPOSITO');
  });

  // ─── 06. Reposición caja chica: sin instancia de flujo → ConflictException ───

  it('06 — ejecutar reposición sin instancia de flujo asociada → ConflictException', async () => {
    const uid = SYSTEM_USER_ID;
    const now = new Date();

    const reposicionId = newId();
    await adminDb.insert(schema.reposicionesCajaChica).values([{
      id: reposicionId, tenantId, fondoId: fondoCajaChicaId,
      montoSolicitado: '1000.0000', moneda: 'DOP',
      instanciaFlujoId: null,
      estado: 'SOLICITADA', eventoOrigenId: null,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await expect(
      reposicionSvc.ejecutar(tenantId, uid, reposicionId),
    ).rejects.toThrow(ConflictException);
  });

  // ─── 07. Reposición caja chica: workflow APROBADO → evento + fondo repuesto ───

  it('07 — ejecutar reposición aprobada → evento reposicion_caja_chica + saldo repuesto', async () => {
    const uid = SYSTEM_USER_ID;
    const now = new Date();

    // Crear tipo_flujo e instancia en estado APROBADO directamente
    const tipoFlujoId = newId();
    await adminPool.query(
      `INSERT INTO tipo_flujo (id,tenant_id,nombre,tipo_documento,activo,created_by,updated_by)
       VALUES ($1,$2,'Reposición CC test','reposicion_caja_chica',true,$3,$3)`,
      [tipoFlujoId, tenantId, uid],
    );

    const instanciaId = newId();
    await adminPool.query(
      `INSERT INTO instancia_flujo
         (id,tenant_id,tipo_flujo_id,tipo_documento,documento_id,documento_tabla,
          monto,moneda,iniciado_por,estado,paso_actual,descripcion,
          created_by,updated_by)
       VALUES ($1,$2,$3,'reposicion_caja_chica',$4,'fondo_caja_chica',
         '2000.0000','DOP',$5,'APROBADO',1,'Reposición caja chica test',$5,$5)`,
      [instanciaId, tenantId, tipoFlujoId, fondoCajaChicaId, uid],
    );

    const reposicionId = newId();
    await adminDb.insert(schema.reposicionesCajaChica).values([{
      id: reposicionId, tenantId, fondoId: fondoCajaChicaId,
      montoSolicitado: '2000.0000', moneda: 'DOP',
      instanciaFlujoId: instanciaId,
      estado: 'SOLICITADA', eventoOrigenId: null,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // Reducimos saldo del fondo para ver el efecto de la reposición
    await adminPool.query(
      `UPDATE fondo_caja_chica SET saldo_disponible='1000.0000' WHERE id=$1`,
      [fondoCajaChicaId],
    );

    const result = await reposicionSvc.ejecutar(tenantId, uid, reposicionId);

    expect(result.eventoId).toBeTruthy();
    // saldo = 1000 (previo) + 2000 (reposicion) = 3000
    expect(new Decimal(result.saldoDisponible).toFixed(4)).toBe('3000.0000');

    const res = await adminPool.query<{ tipo_evento: string }>(
      `SELECT tipo_evento FROM evento_operativo WHERE id=$1`,
      [result.eventoId],
    );
    expect(res.rows[0]!.tipo_evento).toBe('reposicion_caja_chica');
  });

  // ─── 08. Pago sin caja suficiente → EN_ESPERA ────────────────────────────────

  it('08 — ejecutarLote con saldo insuficiente → programacion queda EN_ESPERA', async () => {
    const uid = SYSTEM_USER_ID;
    const now = new Date();

    const cuentaBajaSaldoId = newId();
    await adminDb.insert(schema.cuentasBancarias).values([{
      id: cuentaBajaSaldoId, tenantId, empresaId,
      bancoNombre: 'Banco Pobre Test', numeroCuenta: '110-999-0000002',
      tipoCuenta: 'CORRIENTE', moneda: 'DOP', cuentaContableCodigo: '1101.02',
      saldoActual: '100.0000', activo: true,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    const prog = await programacionSvc.programar(tenantId, uid, {
      empresaId,
      cuentaPorPagarId,
      cuentaBancariaId: cuentaBajaSaldoId,
      monto: '80000.0000',
      moneda: 'DOP',
      fechaProgramada: '2026-02-15',
      prioridad: 1,
      proyectoId,
    });

    const resultados = await programacionSvc.ejecutarLote(tenantId, uid, cuentaBajaSaldoId);

    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.id).toBe(prog.id);
    expect(resultados[0]!.estado).toBe('EN_ESPERA');

    const [progDb] = await adminDb
      .select()
      .from(schema.programacionesPago)
      .where(eq(schema.programacionesPago.id, prog.id));

    expect(progDb!.estado).toBe('EN_ESPERA');
    expect(progDb!.motivoEspera).toContain('Saldo insuficiente');
  });

  // ─── 09. Asiento cobro_recibido: Σdebe = Σhaber ──────────────────────────────

  it('09 — todos los asientos de cobro_recibido de este tenant: Σdebe = Σhaber', async () => {
    const res = await adminPool.query<{ total_debe: string; total_haber: string }>(
      `SELECT
         SUM(CASE WHEN la.tipo='debe'  THEN la.importe::numeric ELSE 0 END) AS total_debe,
         SUM(CASE WHEN la.tipo='haber' THEN la.importe::numeric ELSE 0 END) AS total_haber
       FROM linea_asiento la
       JOIN asiento_contable ac ON ac.id = la.asiento_id
       JOIN evento_operativo eo ON eo.id = ac.evento_id
       WHERE eo.tenant_id=$1 AND eo.tipo_evento='cobro_recibido'`,
      [tenantId],
    );
    const row = res.rows[0]!;
    expect(parseFloat(row.total_debe)).toBeCloseTo(parseFloat(row.total_haber), 4);
  });

  // ─── 10. Conciliación manual e ignorar ───────────────────────────────────────

  it('10 — conciliarManual enlaza línea con movimiento; ignorarLinea marca IGNORADA', async () => {
    const uid = SYSTEM_USER_ID;
    const now = new Date();

    const movId2 = newId();
    await adminDb.insert(schema.movimientosBancarios).values([{
      id: movId2, tenantId, empresaId,
      cuentaBancariaId, tipo: 'RETIRO',
      monto: '500.0000', moneda: 'DOP',
      fecha: '2026-02-01', concepto: 'Gasto varios',
      conciliado: false, lineaExtractoId: null,
      eventoOrigenId: null,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    const extractoId2 = await conciliacionSvc.importarExtracto(tenantId, uid, {
      cuentaBancariaId, empresaId,
      periodoDesde: '2026-02-01', periodoHasta: '2026-02-28',
      archivoNombre: 'extracto-feb.csv',
      lineas: [
        { fecha: '2026-02-01', descripcion: 'Gasto varios', monto: '-500.0000' },
        { fecha: '2026-02-10', descripcion: 'Comisión banco', monto: '-25.0000' },
      ],
    });

    const lineas = await adminPool.query<{ id: string; monto: string }>(
      `SELECT id, monto FROM linea_extracto WHERE extracto_bancario_id=$1 ORDER BY monto`,
      [extractoId2],
    );

    const lineaGasto    = lineas.rows.find(r => parseFloat(r.monto) === -500)!;
    const lineaComision = lineas.rows.find(r => parseFloat(r.monto) === -25)!;

    const conciliada = await conciliacionSvc.conciliarManual(tenantId, uid, lineaGasto.id, movId2);
    expect(conciliada.estado).toBe('CONCILIADA');
    expect(conciliada.movimientoBancarioId).toBe(movId2);

    const ignorada = await conciliacionSvc.ignorarLinea(tenantId, uid, lineaComision.id);
    expect(ignorada.estado).toBe('IGNORADA');
  });
});
