/**
 * PRUEBAS DE INTEGRACIÓN — Generación de PDF (documentos-pdf)
 *
 * Verifican:
 *  01. Generar PDF de OC produce Buffer no vacío con magic bytes %PDF.
 *  02. Generar PDF de cubicación produce Buffer no vacío con magic bytes %PDF.
 *  03. Generar PDF de factura de cliente produce Buffer no vacío con magic bytes %PDF.
 *  04. OC de otro tenant lanza NotFoundException (aislamiento por WHERE tenantId).
 *  05. Cubicación de otro tenant lanza NotFoundException.
 *  06. Factura de otro tenant lanza NotFoundException.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { NotFoundException } from '@nestjs/common';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import { OrdenCompraService } from '../../compras/orden-compra.service.js';
import { CubicacionService } from '../../cxc/cubicacion.service.js';
import { FacturaClienteService } from '../../cxc/factura-cliente.service.js';
import { PdfRenderService } from '../pdf-render.service.js';
import { DocumentosPdfService } from '../documentos-pdf.service.js';

// ── Conexiones ────────────────────────────────────────────────────────────────

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('DocumentosPdf — generación PDF + aislamiento tenants', () => {
  let adminPool: Pool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminDb: any;
  let svc: DocumentosPdfService;

  let tenantId: string;
  let t2: string;
  let empresaId: string;
  let terceroProveedorId: string;
  let terceroClienteId: string;
  let proyectoId: string;
  let partidaId: string;
  let ocId: string;
  let cubicacionId: string;
  let cubicacion2Id: string;  // para factura
  let facturaId: string;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantId          = newId();
    t2                = newId();
    empresaId         = newId();
    terceroProveedorId = newId();
    terceroClienteId  = newId();
    proyectoId        = newId();
    partidaId         = newId();
    ocId              = newId();
    cubicacionId      = newId();
    cubicacion2Id     = newId();
    facturaId         = newId();

    // ── Mock DbService que delega a adminDb (bypassa RLS pero testa WHERE tenantId) ──
    const mockDb = { tx: adminDb, adminDb, appDb: adminDb };
    const ocSvc  = new OrdenCompraService(mockDb as never, {} as never);
    const cubSvc = new CubicacionService(mockDb as never);
    const facSvc = new FacturaClienteService(mockDb as never, {} as never);
    const render = new PdfRenderService();
    svc = new DocumentosPdfService(mockDb as never, ocSvc, cubSvc, facSvc, render);

    // ── Tenants ───────────────────────────────────────────────────────────────
    await adminDb.insert(schema.tenants).values({
      id: tenantId, nombre: 'Constructora PDF [test]',
      slug: `pdf-t1-${tenantId.slice(-8)}`,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await adminDb.insert(schema.tenants).values({
      id: t2, nombre: 'Otra Empresa PDF [test]',
      slug: `pdf-t2-${t2.slice(-8)}`,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    // ── Empresa ───────────────────────────────────────────────────────────────
    await adminDb.insert(schema.empresas).values({
      id: empresaId, tenantId, nombre: 'Constructora PDF SA',
      rnc: '101010101',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    // ── Terceros ──────────────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula, nombre_comercial,
         tipo_contribuyente, condicion_dgii, es_proveedor, es_cliente, created_by, updated_by)
       VALUES ($1,$2,'RNC','101010201','Proveedor PDF SA','PERSONA_JURIDICA','NORMAL',true,false,$3,$3)`,
      [terceroProveedorId, tenantId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula, nombre_comercial,
         tipo_contribuyente, condicion_dgii, es_cliente, es_proveedor, created_by, updated_by)
       VALUES ($1,$2,'RNC','101010202','Cliente PDF SA','PERSONA_JURIDICA','NORMAL',true,false,$3,$3)`,
      [terceroClienteId, tenantId, SYSTEM_USER_ID],
    );

    // ── Proyecto ──────────────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO proyecto (id, tenant_id, empresa_id, codigo, nombre, tipo_obra, cliente_id,
         estado, moneda_contrato, created_by, updated_by)
       VALUES ($1,$2,$3,'PDF-001','Edificio PDF [test]','COMERCIAL',$4,
               'EN_EJECUCION','DOP',$5,$5)`,
      [proyectoId, tenantId, empresaId, terceroClienteId, SYSTEM_USER_ID],
    );

    // ── Partida ───────────────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO partida (id, tenant_id, proyecto_id, codigo, numero_jerarquico, nombre,
         nivel, created_by, updated_by)
       VALUES ($1,$2,$3,'01','01','Estructuras PDF [test]',1,$4,$4)`,
      [partidaId, tenantId, proyectoId, SYSTEM_USER_ID],
    );

    // ── Orden de Compra + Línea ───────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO orden_compra (id, tenant_id, empresa_id, numero, estado, tercero_id,
         fecha_emision, total_monto, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,'OC-PDF-001','EMITIDA',$4,'2026-06-01','5000.0000','DOP',$5,$5)`,
      [ocId, tenantId, empresaId, terceroProveedorId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO linea_orden_compra (id, tenant_id, orden_compra_id, partida_id, descripcion,
         cantidad, unidad_medida, precio_unitario, total, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'Cemento Portland 42.5 kg',50,'SAC','100.0000','5000.0000','DOP',$5,$5)`,
      [newId(), tenantId, ocId, partidaId, SYSTEM_USER_ID],
    );

    // ── Cubicación + Línea (inserción directa, sin necesitar presupuesto) ─────
    await adminPool.query(
      `INSERT INTO cubicacion (id, tenant_id, empresa_id, proyecto_id, numero, fecha_corte,
         monto_bruto, monto_retencion_garantia, monto_facturable,
         moneda, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,1,'2026-06-30',
               '8000.0000','400.0000','7600.0000','DOP','EMITIDA',$5,$5)`,
      [cubicacionId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO cubicacion_linea (id, tenant_id, cubicacion_id, partida_id,
         cantidad_anterior, cantidad_periodo, cantidad_acumulada,
         precio_unitario, monto, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'0.0000','80.0000','80.0000','100.0000','8000.0000','DOP',$5,$5)`,
      [newId(), tenantId, cubicacionId, partidaId, SYSTEM_USER_ID],
    );

    // ── Segunda cubicación para la factura ────────────────────────────────────
    await adminPool.query(
      `INSERT INTO cubicacion (id, tenant_id, empresa_id, proyecto_id, numero, fecha_corte,
         monto_bruto, monto_retencion_garantia, monto_facturable,
         moneda, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,2,'2026-07-31',
               '5000.0000','250.0000','4750.0000','DOP','EMITIDA',$5,$5)`,
      [cubicacion2Id, tenantId, empresaId, proyectoId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO cubicacion_linea (id, tenant_id, cubicacion_id, partida_id,
         cantidad_anterior, cantidad_periodo, cantidad_acumulada,
         precio_unitario, monto, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'80.0000','50.0000','130.0000','100.0000','5000.0000','DOP',$5,$5)`,
      [newId(), tenantId, cubicacion2Id, partidaId, SYSTEM_USER_ID],
    );

    // ── Factura de Cliente ────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO factura_cliente (id, tenant_id, empresa_id, proyecto_id, cliente_id,
         cubicacion_id, numero, fecha_emision,
         monto_subtotal, monto_itbis, monto_retencion_isr, monto_retencion_itbis,
         monto_total, monto_neto_a_cobrar, moneda, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'FC-PDF-001','2026-07-31',
               '4750.0000','855.0000','0.0000','0.0000',
               '5605.0000','5605.0000','DOP','EMITIDA',$7,$7)`,
      [facturaId, tenantId, empresaId, proyectoId, terceroClienteId, cubicacion2Id, SYSTEM_USER_ID],
    );
  });

  afterAll(async () => {
    // Limpieza en orden FK inverso
    await adminPool.query(`DELETE FROM factura_cliente WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM cubicacion_linea WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM cubicacion WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM linea_orden_compra WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE orden_compra DISABLE TRIGGER no_delete_orden_compra`);
    await adminPool.query(`DELETE FROM orden_compra WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE orden_compra ENABLE TRIGGER no_delete_orden_compra`);
    await adminPool.query(`DELETE FROM partida WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM tenant WHERE id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.end();
  });

  // ── Test 01: PDF de OC ──────────────────────────────────────────────────────

  it('01. Genera PDF de Orden de Compra — Buffer no vacío con magic bytes %PDF', async () => {
    const buffer = await svc.generarOrdenCompraPdf(tenantId, ocId);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
    // PDF spec: los primeros 4 bytes deben ser '%PDF'
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');
  });

  // ── Test 02: PDF de Cubicación ──────────────────────────────────────────────

  it('02. Genera PDF de Cubicación — Buffer no vacío con magic bytes %PDF', async () => {
    const buffer = await svc.generarCubicacionPdf(tenantId, cubicacionId);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');
  });

  // ── Test 03: PDF de Factura de Cliente ─────────────────────────────────────

  it('03. Genera PDF de Factura de Cliente — Buffer no vacío con magic bytes %PDF', async () => {
    const buffer = await svc.generarFacturaClientePdf(tenantId, facturaId);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');
  });

  // ── Test 04-06: Aislamiento cross-tenant ────────────────────────────────────

  it('04. Tenant2 no puede obtener PDF de OC del tenant1 — NotFoundException', async () => {
    await expect(
      svc.generarOrdenCompraPdf(t2, ocId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('05. Tenant2 no puede obtener PDF de cubicación del tenant1 — NotFoundException', async () => {
    await expect(
      svc.generarCubicacionPdf(t2, cubicacionId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('06. Tenant2 no puede obtener PDF de factura del tenant1 — NotFoundException', async () => {
    await expect(
      svc.generarFacturaClientePdf(t2, facturaId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
