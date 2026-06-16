/**
 * PRUEBAS DE INTEGRACIÓN — Emisión de e-CF de venta (Sesión 4 Capa 2, ADR-0007)
 *
 *  01. Factura de cliente (E31) → e-CF aceptado por el middleware, con la
 *      estructura correcta y asociado a su acuse.
 *  02. Nota de crédito (E34) referencia correctamente su e-CF de origen.
 *  03. Contingencia: el middleware no disponible produce una RI válida y no
 *      genera acuse.
 *  04. RECHAZADO: se conserva el comprobante como rastro de auditoría, pero
 *      no se genera acuse ni se actualiza el NCF de la factura.
 *  05. RLS: tenant2 no ve comprobantes ni acuses e-CF de tenant1.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import type { EcfDocumento, MiddlewareEcfRespuesta, IMiddlewareEcfClient } from '@tributia/localizacion-do';
import { DbService } from '../../database/db.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { ProjectionEngineService } from '../../ledger/projection-engine.service.js';
import { CatalogoDgiiService } from '../../catalogos/catalogo-dgii.service.js';
import { EmisionEcfService } from '../emision-ecf.service.js';

// ─── Conexiones ───────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';
const APP_URL =
  process.env['DATABASE_URL_APP'] ?? 'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

/** Middleware de prueba — estado controlable por test, sin aleatoriedad. */
class TestMiddlewareEcfClient implements IMiddlewareEcfClient {
  estado: 'ACEPTADO' | 'RECHAZADO' | 'CONTINGENCIA' = 'ACEPTADO';

  transmitir(documento: EcfDocumento): Promise<MiddlewareEcfRespuesta> {
    if (this.estado === 'CONTINGENCIA') {
      return Promise.resolve({ estado: 'CONTINGENCIA', payloadAcuse: {} });
    }
    if (this.estado === 'RECHAZADO') {
      return Promise.resolve({ estado: 'RECHAZADO', mensaje: 'Rechazado por DGII (test)', payloadAcuse: {} });
    }
    return Promise.resolve({
      estado: 'ACEPTADO',
      codigoSeguridad: 'TESTSEG000001',
      fechaRecepcionDgii: new Date().toISOString(),
      payloadAcuse: { ncf: documento.ncf, tipo: documento.tipo, totales: documento.totales },
    });
  }
}

describe('Emisión e-CF — middleware, contingencia y RI', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  let tenantId: string;
  let t2: string;
  let empresaId: string;
  let proyectoId: string;
  let clienteId: string;

  let cubicacion1Id: string;
  let cubicacion2Id: string;
  let cubicacion3Id: string;
  let factura1Id: string;
  let factura2Id: string;
  let factura3Id: string;

  let emisionSvc: EmisionEcfService;
  let middleware: TestMiddlewareEcfClient;

  let comprobanteE31Id: string;
  let fechaEmisionE31: string;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool = new Pool({ connectionString: APP_URL });
    adminDb = drizzle(adminPool, { schema });

    tenantId = newId();
    t2 = newId();
    empresaId = newId();
    proyectoId = newId();
    clienteId = newId();
    cubicacion1Id = newId();
    cubicacion2Id = newId();
    cubicacion3Id = newId();
    factura1Id = newId();
    factura2Id = newId();
    factura3Id = newId();

    const uid = SYSTEM_USER_ID;
    const now = new Date();

    await adminDb.insert(schema.tenants).values([
      { id: tenantId, nombre: 'T-ECF', slug: `ecf-t1-${tenantId.slice(-12)}`, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
      { id: t2, nombre: 'T-ECF-2', slug: `ecf-t2-${t2.slice(-12)}`, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);

    await adminDb.insert(schema.empresas).values([
      { id: empresaId, tenantId, nombre: 'Empresa e-CF Test', createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid },
    ]);

    await adminDb.insert(schema.terceros).values([
      {
        id: clienteId, tenantId, tipoIdentificacion: 'RNC', rncCedula: '101900001',
        nombreComercial: 'Cliente e-CF SA [test]', tipoContribuyente: 'PERSONA_JURIDICA',
        condicionDgii: 'NORMAL', esCliente: true,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    await adminDb.insert(schema.proyectos).values([
      {
        id: proyectoId, tenantId, empresaId, clienteId,
        nombre: 'Proyecto e-CF', codigo: 'PRY-ECF-1', estado: 'EN_EJECUCION',
        monedaContrato: 'DOP', montoContrato: '1000000.0000', tipoObra: 'OTRO',
        presupuestoVigenteMonto: '0.0000',
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      },
    ]);

    // ── Catálogo DGII de tipos e-CF (idempotente, tabla de sistema) ───────────
    for (const codigo of ['e31', 'e32', 'e33', 'e34']) {
      await adminPool.query(
        `INSERT INTO tipo_ecf (id, codigo, nombre, descripcion, valido_desde, activo)
         VALUES ($1,$2,$2,'e-CF de prueba','2019-01-01',true)
         ON CONFLICT (codigo) DO NOTHING`,
        [newId(), codigo],
      );
    }

    // ── Configuración de emisor + secuencias de NCF ───────────────────────────
    await adminDb.insert(schema.configuracionesEmisorEcf).values([{
      id: newId(), tenantId, empresaId, ambiente: 'TEST',
      rncEmisor: '130000001', razonSocialEmisor: 'Constructora e-CF Test SRL',
      certificadoReferencia: 'vault://certificados/empresa-ecf-test',
      createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    }]);

    await adminDb.insert(schema.secuenciasEcf).values(
      (['E31', 'E32', 'E33', 'E34'] as const).map((tipoEcf) => ({
        id: newId(), tenantId, empresaId, tipoEcf,
        proximoNumero: 1, rangoAutorizadoDesde: 1, rangoAutorizadoHasta: 100,
        createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
      })),
    );

    // ── Cubicaciones + facturas de cliente (ncf null — aún no emitido) ────────
    for (const [cubId, numero] of [
      [cubicacion1Id, 1],
      [cubicacion2Id, 2],
      [cubicacion3Id, 3],
    ] as const) {
      await adminPool.query(
        `INSERT INTO cubicacion (id, tenant_id, empresa_id, proyecto_id, numero, fecha_corte, monto_bruto, monto_facturable, moneda, estado, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,'2026-06-01','10000.0000','10000.0000','DOP','EMITIDA',$6,$6)`,
        [cubId, tenantId, empresaId, proyectoId, numero, uid],
      );
    }

    for (const [facId, cubId, numero, eventoId] of [
      [factura1Id, cubicacion1Id, 'FC-ECF-001', newId()],
      [factura2Id, cubicacion2Id, 'FC-ECF-002', newId()],
      [factura3Id, cubicacion3Id, 'FC-ECF-003', newId()],
    ] as const) {
      await adminPool.query(
        `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,'emision_factura_cliente',$5,'{}'::jsonb,$6,$5)`,
        [eventoId, tenantId, empresaId, proyectoId, uid, `ecf-fixture-${eventoId}`],
      );
      await adminPool.query(
        `INSERT INTO factura_cliente (id, tenant_id, empresa_id, proyecto_id, cliente_id, cubicacion_id, numero, fecha_emision, monto_subtotal, monto_itbis, monto_total, monto_neto_a_cobrar, estado, evento_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-06-01','10000.0000','1800.0000','11800.0000','11800.0000','EMITIDA',$8,$9,$9)`,
        [facId, tenantId, empresaId, proyectoId, clienteId, cubId, numero, eventoId, uid],
      );
    }

    // ── Servicios bajo prueba (wiring manual, sin contenedor Nest) ─────────────
    const dbSvc = { tx: adminDb } as unknown as DbService;
    const catalogoDgiiSvc = new CatalogoDgiiService(dbSvc);
    const projEngine = new ProjectionEngineService([], dbSvc);
    const ledgerSvc = new LedgerService(dbSvc, projEngine);
    middleware = new TestMiddlewareEcfClient();
    emisionSvc = new EmisionEcfService(dbSvc, ledgerSvc, catalogoDgiiSvc, middleware);
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM acuse_ecf WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM comprobante_ecf WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM secuencia_ecf WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM configuracion_emisor_ecf WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);

    await adminPool.query(`DELETE FROM factura_cliente WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM cubicacion WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);

    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);

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

  // ── TEST 01: Factura → e-CF E31 aceptado + acuse ──────────────────────────
  it('01. Emite un e-CF E31 desde una factura de cliente, aceptado por el middleware, con su acuse', async () => {
    const resultado = await emisionSvc.emitir(
      tenantId,
      { tipo: 'E31', facturaClienteId: factura1Id },
      SYSTEM_USER_ID,
    );

    comprobanteE31Id = resultado.id;
    expect(resultado.estado).toBe('ACEPTADO');
    expect(resultado.enContingencia).toBe(false);
    expect(resultado.ncf).toBe('E3100000001');
    expect(resultado.eventoId).toBeTruthy();

    const detalle = await emisionSvc.findById(tenantId, comprobanteE31Id);
    expect(detalle.tipoEcf).toBe('E31');
    expect(detalle.estado).toBe('ACEPTADO');
    expect(detalle.facturaClienteId).toBe(factura1Id);
    expect(detalle.montoSubtotal).toBe('10000.0000');
    expect(detalle.montoItbis).toBe('1800.0000');
    expect(detalle.montoTotal).toBe('11800.0000');
    fechaEmisionE31 = detalle.fechaEmision;

    const documento = detalle.documento as EcfDocumento;
    expect(documento.version).toBe('1.0');
    expect(documento.tipo).toBe('E31');
    expect(documento.ncf).toBe('E3100000001');
    expect(documento.emisor).toEqual({ rnc: '130000001', razonSocial: 'Constructora e-CF Test SRL' });
    expect(documento.receptor).toEqual({ rncOCedula: '101900001', razonSocial: 'Cliente e-CF SA [test]' });
    expect(documento.totales.montoTotal).toEqual({ amount: '11800.0000', currency: 'DOP' });
    expect(documento.referenciaOrigen).toBeUndefined();

    expect(detalle.acuse).not.toBeNull();
    expect(detalle.acuse!.estadoDgii).toBe('ACEPTADO');
    expect(detalle.acuse!.codigoSeguridad).toBe('TESTSEG000001');
    expect(detalle.acuse!.hashIntegridad).toHaveLength(64);

    // Evento del ledger registrado y vinculado.
    const [evento] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, resultado.eventoId));
    expect(evento).toBeDefined();
    expect(evento!.tipoEvento).toBe('emision_ecf');

    // La factura del cliente queda con su NCF propio.
    const [factura] = await adminDb.select().from(schema.facturasCliente).where(eq(schema.facturasCliente.id, factura1Id));
    expect(factura!.ncf).toBe('E3100000001');
  });

  // ── TEST 02: Nota de crédito (E34) referencia su e-CF de origen ───────────
  it('02. Emite una nota de crédito (E34) que referencia correctamente el e-CF E31 de origen', async () => {
    const resultado = await emisionSvc.emitir(
      tenantId,
      {
        tipo: 'E34',
        comprobanteOrigenId: comprobanteE31Id,
        motivoAjuste: 'Devolución parcial de material facturado [test]',
        montoSubtotal: '2000.0000',
        montoItbis: '360.0000',
      },
      SYSTEM_USER_ID,
    );

    expect(resultado.estado).toBe('ACEPTADO');
    expect(resultado.ncf).toBe('E3400000001');

    const detalle = await emisionSvc.findById(tenantId, resultado.id);
    expect(detalle.comprobanteOrigenId).toBe(comprobanteE31Id);
    expect(detalle.facturaClienteId).toBeNull();
    expect(detalle.montoTotal).toBe('2360.0000');

    const documento = detalle.documento as EcfDocumento;
    expect(documento.tipo).toBe('E34');
    expect(documento.referenciaOrigen).toEqual({
      ncfOrigen: 'E3100000001',
      fechaEmisionOrigen: fechaEmisionE31,
      montoOrigen: { amount: '11800.0000', currency: 'DOP' },
    });
    // El receptor de la nota de crédito hereda el del e-CF que modifica.
    expect(documento.receptor).toEqual({ rncOCedula: '101900001', razonSocial: 'Cliente e-CF SA [test]' });
  });

  // ── TEST 03: Contingencia → RI válida, sin acuse ───────────────────────────
  it('03. El middleware no disponible produce una RI válida y no genera acuse', async () => {
    middleware.estado = 'CONTINGENCIA';
    try {
      const resultado = await emisionSvc.emitir(
        tenantId,
        { tipo: 'E32', facturaClienteId: factura2Id },
        SYSTEM_USER_ID,
      );

      expect(resultado.estado).toBe('CONTINGENCIA');
      expect(resultado.enContingencia).toBe(true);
      expect(resultado.ncf).toBe('E3200000001');
      expect(resultado.ri).toBeDefined();
      expect(resultado.ri!.numeroRi).toBe('RI-E3200000001');
      expect(resultado.ri!.codigoSeguridad).toHaveLength(12);
      expect(resultado.ri!.motivo).toBe('MIDDLEWARE_NO_DISPONIBLE');
      expect(new Date(resultado.ri!.fechaLimiteRegularizacion).getTime()).toBeGreaterThan(
        new Date(resultado.ri!.fechaEmision).getTime(),
      );

      const detalle = await emisionSvc.findById(tenantId, resultado.id);
      expect(detalle.enContingencia).toBe(true);
      expect(detalle.riNumero).toBe('RI-E3200000001');
      expect(detalle.riCodigoSeguridad).not.toBeNull();
      expect(detalle.riFechaLimiteRegularizacion).not.toBeNull();
      expect(detalle.acuse).toBeNull();

      // El NCF se asignó y se reservó en la factura aunque la transmisión esté pendiente.
      const [factura] = await adminDb.select().from(schema.facturasCliente).where(eq(schema.facturasCliente.id, factura2Id));
      expect(factura!.ncf).toBe('E3200000001');
    } finally {
      middleware.estado = 'ACEPTADO';
    }
  });

  // ── TEST 04: Rechazo — rastro de auditoría sin acuse ni NCF en la factura ──
  it('04. Un e-CF rechazado por la DGII se conserva como rastro de auditoría, sin acuse ni NCF en la factura', async () => {
    middleware.estado = 'RECHAZADO';
    try {
      const resultado = await emisionSvc.emitir(
        tenantId,
        { tipo: 'E32', facturaClienteId: factura3Id },
        SYSTEM_USER_ID,
      );

      expect(resultado.estado).toBe('RECHAZADO');

      const detalle = await emisionSvc.findById(tenantId, resultado.id);
      expect(detalle.estado).toBe('RECHAZADO');
      expect(detalle.acuse).toBeNull();

      const [factura] = await adminDb.select().from(schema.facturasCliente).where(eq(schema.facturasCliente.id, factura3Id));
      expect(factura!.ncf).toBeNull();
    } finally {
      middleware.estado = 'ACEPTADO';
    }
  });

  // ── TEST 05: RLS ────────────────────────────────────────────────────────────
  it('05. RLS: tenant2 no ve comprobantes ni acuses e-CF de tenant1', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${t2}'`);

      const { rows: comprobanteRows } = await client.query(`SELECT id FROM comprobante_ecf WHERE tenant_id = $1`, [tenantId]);
      expect(comprobanteRows.length).toBe(0);

      const { rows: acuseRows } = await client.query(`SELECT id FROM acuse_ecf WHERE tenant_id = $1`, [tenantId]);
      expect(acuseRows.length).toBe(0);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
