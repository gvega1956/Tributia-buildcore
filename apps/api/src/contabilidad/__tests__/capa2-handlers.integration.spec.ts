/**
 * PRUEBAS DE INTEGRACIÓN — Handlers contables Capa 2: asientos exactos (Sesión 8 Capa 2)
 *
 * Defecto C de la auditoría: `gasto_caja_chica`, `reposicion_caja_chica` y `pago_emitido`
 * tenían handlers contables REQUERIDOS (o con regla opcional) pero ningún test verificaba
 * los importes exactos en linea_asiento. Esta suite cierra esa brecha.
 *
 * 01. gasto_caja_chica (REQUERIDA): DEBE 5101 / HABER 1103 con importe exacto = 3500.0000
 * 02. reposicion_caja_chica (REQUERIDA): DEBE 1103 / HABER 1101 con importe exacto = 5000.0000
 * 03. pago_emitido (OPCIONAL pero con regla): DEBE 2101 / HABER 1101 con importe exacto = 25000.0000
 * 04. gasto_caja_chica sin regla → throw visible (no graceful-skip)
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
import { ReglaContableService } from '../regla-contable.service.js';
import { CuentaContableService } from '../cuenta-contable.service.js';
import { AsientoContableService } from '../asiento-contable.service.js';
import { ContabilidadGastoCajaChicaHandler } from '../handlers/contabilidad-gasto-caja-chica.handler.js';
import { ContabilidadReposicionCajaChicaHandler } from '../handlers/contabilidad-reposicion-caja-chica.handler.js';
import { ContabilidadPagoEmitidoHandler } from '../handlers/contabilidad-pago-emitido.handler.js';

const ADMIN_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

describe('Capa 2 — handlers contables: asientos exactos (auditoría Defecto C)', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  let tenantId: string;
  let empresaId: string;
  let proyectoId: string;

  let ledgerSvc: LedgerService;

  const uid = SYSTEM_USER_ID;
  const now = new Date();

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb = drizzle(adminPool, { schema });

    tenantId  = newId();
    empresaId = newId();
    proyectoId = newId();

    // ── Tenant + Empresa ────────────────────────────────────────────────────────
    await adminDb.insert(schema.tenants).values([{
      id: tenantId, nombre: 'Tenant Capa2 Handlers', slug: `c2h-${tenantId.slice(-12)}`,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);
    await adminDb.insert(schema.empresas).values([{
      id: empresaId, tenantId, nombre: 'Empresa Capa2 Handlers Test',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Tercero (cliente FK en proyecto) ────────────────────────────────────────
    const terceroId = newId();
    await adminDb.insert(schema.terceros).values([{
      id: terceroId, tenantId, tipoIdentificacion: 'RNC', rncCedula: '101888001',
      nombreComercial: 'Cliente C2H', tipoContribuyente: 'PERSONA_JURIDICA',
      condicionDgii: 'NORMAL', esCliente: true,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    // ── Proyecto (necesario por CHECK imputación P3) ────────────────────────────
    await adminPool.query(
      `INSERT INTO proyecto (id,tenant_id,empresa_id,nombre,codigo,estado,tipo_obra,cliente_id,
        moneda_contrato,monto_contrato,presupuesto_vigente_monto,created_by,updated_by)
       VALUES ($1,$2,$3,'Proyecto C2H','PRY-C2H','EN_EJECUCION','OTRO',$4,'DOP','1000000.0000','0.0000',$5,$5)`,
      [proyectoId, tenantId, empresaId, terceroId, uid],
    );

    // ── Cuentas contables ───────────────────────────────────────────────────────
    const cuentas: Array<[string, string, string, string]> = [
      ['1101.01', 'Bancos',            'activo',  'deudora'],
      ['1103.01', 'Fondo Caja Chica',  'activo',  'deudora'],
      ['2101.01', 'Cuentas por Pagar', 'pasivo',  'acreedora'],
      ['5101.01', 'Gastos Diversos',   'gasto',   'deudora'],
    ];
    for (const [codigo, nombre, tipo, naturaleza] of cuentas) {
      await adminPool.query(
        `INSERT INTO cuenta_contable (id,tenant_id,empresa_id,codigo,nombre,tipo,naturaleza,nivel,
           es_movimiento,activo,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,4,true,true,$8,$8)`,
        [newId(), tenantId, empresaId, codigo, nombre, tipo, naturaleza, uid],
      );
    }

    // ── Reglas contables ────────────────────────────────────────────────────────
    const reglas: Array<[string, ConfiguracionRegla]> = [
      ['gasto_caja_chica', {
        lineas: [
          { tipo: 'debito',  cuentaCodigo: '5101.01', descripcion: 'Gasto operativo' },
          { tipo: 'credito', cuentaCodigo: '1103.01', descripcion: 'Fondo caja chica' },
        ],
      }],
      ['reposicion_caja_chica', {
        lineas: [
          { tipo: 'debito',  cuentaCodigo: '1103.01', descripcion: 'Repone fondo' },
          { tipo: 'credito', cuentaCodigo: '1101.01', descripcion: 'Bancos (reposición)' },
        ],
      }],
      ['pago_emitido', {
        lineas: [
          { tipo: 'debito',  cuentaCodigo: '2101.01', descripcion: 'Cancela CxP' },
          { tipo: 'credito', cuentaCodigo: '1101.01', descripcion: 'Bancos (pago)' },
        ],
      }],
    ];
    for (const [tipoEvento, config] of reglas) {
      await adminPool.query(
        `INSERT INTO regla_contable (id,tenant_id,empresa_id,tipo_evento,nombre,configuracion,
           prioridad,activo,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,0,true,$7,$7)`,
        [newId(), tenantId, empresaId, tipoEvento, `Regla ${tipoEvento}`, JSON.stringify(config), uid],
      );
    }

    // ── Wiring de servicios ─────────────────────────────────────────────────────
    const dbSvc   = { tx: adminDb } as unknown as DbService;
    const reglaSvc   = new ReglaContableService();
    const cuentaSvc  = new CuentaContableService(null as never);
    const asientoSvc = new AsientoContableService(null as never, cuentaSvc);

    const gastoHdlr     = new ContabilidadGastoCajaChicaHandler(reglaSvc, asientoSvc);
    const reposicionHdlr = new ContabilidadReposicionCajaChicaHandler(reglaSvc, asientoSvc);
    const pagoHdlr      = new ContabilidadPagoEmitidoHandler(reglaSvc, asientoSvc);

    const projEngine = new ProjectionEngineService([gastoHdlr, reposicionHdlr, pagoHdlr], dbSvc);
    ledgerSvc = new LedgerService(dbSvc, projEngine);
  });

  // ── 01. gasto_caja_chica genera DEBE 5101 / HABER 1103 con importe exacto ──
  it('01. gasto_caja_chica: asiento DEBE Gastos / HABER CajaChica importe=3500.0000', async () => {
    const fondoFakeId = newId(); // no se usa en el handler, solo en el payload
    const evento = await ledgerSvc.append({
      tenantId, empresaId, proyectoId,
      tipoEvento: 'gasto_caja_chica',
      usuarioId: uid,
      payload: {
        fondoId: fondoFakeId,
        monto: { amount: '3500.0000', currency: 'DOP' },
        concepto: 'Cemento para tabique (prueba auditoría)',
        numeroComprobante: 'B010000001',
        tipoComprobante: 'NCF',
        proveedorTerceroId: null,
        partidaId: null,
      },
      idempotencyKey: `test-gasto-c2h-${newId()}`,
    });

    // Verificar que el asiento fue generado con los importes correctos
    const [asiento] = await adminDb
      .select({ id: schema.asientosContables.id })
      .from(schema.asientosContables)
      .where(eq(schema.asientosContables.eventoId, evento.id));

    expect(asiento, 'debe existir un asiento para el evento').toBeDefined();

    const lineas = await adminDb
      .select({
        tipo: schema.lineasAsiento.tipo,
        importe: schema.lineasAsiento.importe,
        codigo: schema.cuentasContables.codigo,
      })
      .from(schema.lineasAsiento)
      .innerJoin(schema.cuentasContables, eq(schema.lineasAsiento.cuentaId, schema.cuentasContables.id))
      .where(eq(schema.lineasAsiento.asientoId, asiento!.id));

    const debe  = lineas.find((l) => l.tipo === 'debe');
    const haber = lineas.find((l) => l.tipo === 'haber');

    expect(debe?.codigo).toBe('5101.01');
    expect(new Decimal(debe!.importe).toFixed(4)).toBe('3500.0000');
    expect(haber?.codigo).toBe('1103.01');
    expect(new Decimal(haber!.importe).toFixed(4)).toBe('3500.0000');

    // P4: balance invariante
    const sumaDebe  = lineas.filter((l) => l.tipo === 'debe').reduce((s, l) => s.plus(l.importe), new Decimal(0));
    const sumaHaber = lineas.filter((l) => l.tipo === 'haber').reduce((s, l) => s.plus(l.importe), new Decimal(0));
    expect(sumaDebe.eq(sumaHaber)).toBe(true);
  });

  // ── 02. reposicion_caja_chica genera DEBE 1103 / HABER 1101 con importe exacto
  it('02. reposicion_caja_chica: asiento DEBE CajaChica / HABER Bancos importe=5000.0000', async () => {
    const evento = await ledgerSvc.append({
      tenantId, empresaId, proyectoId,
      tipoEvento: 'reposicion_caja_chica',
      usuarioId: uid,
      payload: {
        fondoId: newId(),
        reposicionId: newId(),
        cuentaBancariaOrigenId: newId(),
        monto: { amount: '5000.0000', currency: 'DOP' },
        instanciaFlujoId: newId(),
      },
      idempotencyKey: `test-repos-c2h-${newId()}`,
    });

    const [asiento] = await adminDb
      .select({ id: schema.asientosContables.id })
      .from(schema.asientosContables)
      .where(eq(schema.asientosContables.eventoId, evento.id));

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

    const debe  = lineas.find((l) => l.tipo === 'debe');
    const haber = lineas.find((l) => l.tipo === 'haber');

    expect(debe?.codigo).toBe('1103.01');
    expect(new Decimal(debe!.importe).toFixed(4)).toBe('5000.0000');
    expect(haber?.codigo).toBe('1101.01');
    expect(new Decimal(haber!.importe).toFixed(4)).toBe('5000.0000');

    // P4: balance invariante
    const sumaDebe  = lineas.filter((l) => l.tipo === 'debe').reduce((s, l) => s.plus(l.importe), new Decimal(0));
    const sumaHaber = lineas.filter((l) => l.tipo === 'haber').reduce((s, l) => s.plus(l.importe), new Decimal(0));
    expect(sumaDebe.eq(sumaHaber)).toBe(true);
  });

  // ── 03. pago_emitido con regla → genera DEBE 2101 / HABER 1101 ─────────────
  it('03. pago_emitido (con regla): asiento DEBE CxP / HABER Bancos importe=25000.0000', async () => {
    const evento = await ledgerSvc.append({
      tenantId, empresaId, proyectoId,
      tipoEvento: 'pago_emitido',
      usuarioId: uid,
      payload: {
        cuentaBancariaId: newId(),
        monto: { amount: '25000.0000', currency: 'DOP' },
        concepto: 'Pago proveedor cemento (prueba auditoría)',
        cuentasPorPagarIds: [newId()],
        referenciaBancaria: null,
      },
      idempotencyKey: `test-pago-c2h-${newId()}`,
    });

    const [asiento] = await adminDb
      .select({ id: schema.asientosContables.id })
      .from(schema.asientosContables)
      .where(eq(schema.asientosContables.eventoId, evento.id));

    expect(asiento, 'debe existir asiento para pago_emitido cuando la regla está configurada').toBeDefined();

    const lineas = await adminDb
      .select({
        tipo: schema.lineasAsiento.tipo,
        importe: schema.lineasAsiento.importe,
        codigo: schema.cuentasContables.codigo,
      })
      .from(schema.lineasAsiento)
      .innerJoin(schema.cuentasContables, eq(schema.lineasAsiento.cuentaId, schema.cuentasContables.id))
      .where(eq(schema.lineasAsiento.asientoId, asiento!.id));

    const debe  = lineas.find((l) => l.tipo === 'debe');
    const haber = lineas.find((l) => l.tipo === 'haber');

    expect(debe?.codigo).toBe('2101.01');
    expect(new Decimal(debe!.importe).toFixed(4)).toBe('25000.0000');
    expect(haber?.codigo).toBe('1101.01');
    expect(new Decimal(haber!.importe).toFixed(4)).toBe('25000.0000');

    // P4: balance invariante
    const sumaDebe  = lineas.filter((l) => l.tipo === 'debe').reduce((s, l) => s.plus(l.importe), new Decimal(0));
    const sumaHaber = lineas.filter((l) => l.tipo === 'haber').reduce((s, l) => s.plus(l.importe), new Decimal(0));
    expect(sumaDebe.eq(sumaHaber)).toBe(true);
  });

  // ── 04. gasto_caja_chica sin regla → throw visible (no graceful-skip) ───────
  it('04. gasto_caja_chica sin regla → throw Error explícito (no silencio)', async () => {
    // Crear tenant alternativo SIN regla configurada
    const tenantAlt   = newId();
    const empresaAlt  = newId();
    const terceroAlt  = newId();
    const proyectoAlt = newId();

    await adminDb.insert(schema.tenants).values([{
      id: tenantAlt, nombre: 'Tenant Alt NoRegla', slug: `nr-${tenantAlt.slice(-12)}`,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);
    await adminDb.insert(schema.empresas).values([{
      id: empresaAlt, tenantId: tenantAlt, nombre: 'Empresa Sin Regla',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);
    await adminDb.insert(schema.terceros).values([{
      id: terceroAlt, tenantId: tenantAlt, tipoIdentificacion: 'RNC', rncCedula: '101777001',
      nombreComercial: 'Cliente Alt', tipoContribuyente: 'PERSONA_JURIDICA',
      condicionDgii: 'NORMAL', esCliente: true,
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);
    await adminPool.query(
      `INSERT INTO proyecto (id,tenant_id,empresa_id,nombre,codigo,estado,tipo_obra,cliente_id,
        moneda_contrato,monto_contrato,presupuesto_vigente_monto,created_by,updated_by)
       VALUES ($1,$2,$3,'Proyecto Alt','PRY-ALT','EN_EJECUCION','OTRO',$4,'DOP','1000000.0000','0.0000',$5,$5)`,
      [proyectoAlt, tenantAlt, empresaAlt, terceroAlt, uid],
    );

    const dbAlt   = { tx: adminDb } as unknown as DbService;
    const reglaSvcAlt   = new ReglaContableService();
    const cuentaSvcAlt  = new CuentaContableService(null as never);
    const asientoSvcAlt = new AsientoContableService(null as never, cuentaSvcAlt);
    const gastoHdlrAlt  = new ContabilidadGastoCajaChicaHandler(reglaSvcAlt, asientoSvcAlt);
    const engAlt        = new ProjectionEngineService([gastoHdlrAlt], dbAlt);
    const ledgerAlt     = new LedgerService(dbAlt, engAlt);

    await expect(
      ledgerAlt.append({
        tenantId: tenantAlt, empresaId: empresaAlt, proyectoId: proyectoAlt,
        tipoEvento: 'gasto_caja_chica',
        usuarioId: uid,
        payload: {
          fondoId: newId(),
          monto: { amount: '100.0000', currency: 'DOP' },
          concepto: 'Test sin regla',
          numeroComprobante: 'B010000999',
          tipoComprobante: 'NCF',
          proveedorTerceroId: null,
          partidaId: null,
        },
        idempotencyKey: `test-sinregla-${newId()}`,
      }),
    ).rejects.toThrow(/Regla contable requerida para 'gasto_caja_chica'/);

    // Cleanup alternativo.
    // Orden: hijos primero; audit_log SIEMPRE al final (las DELETEs de abajo pueden generar
    // nuevas filas de audit porque el trigger de auditoría sigue activo aunque se deshabilite
    // el trigger de inmutabilidad).
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id=$1`, [tenantAlt]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id=$1`, [tenantAlt]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id=$1`, [tenantAlt]);
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id=$1`, [tenantAlt]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id=$1`, [tenantAlt]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id=$1`, [tenantAlt]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM linea_asiento WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM asiento_contable WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM regla_contable WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`DELETE FROM cuenta_contable WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id=$1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
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
