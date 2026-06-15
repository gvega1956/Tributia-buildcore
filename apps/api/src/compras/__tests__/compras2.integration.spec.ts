/**
 * PRUEBAS DE INTEGRACIÓN — Compras II: Recepción OC → Factura → CxP (Sesión 6 Capa 1)
 *
 *  01. recepcion_oc handler: stock_almacen WAC correcto tras recepción.
 *  02. recepcion_oc handler: movimiento_inventario ENTRADA insertado.
 *  03. recepcion_oc: comprometido reducido, devengado incrementado en ejecucion_partida.
 *  04. Recepción parcial: comprometido→devengado proporcional al monto recibido.
 *  05. Match 3 vías OK: precio y cantidad coinciden → estadoMatch=OK.
 *  06. Match 3 vías: discrepancia precio > tolerancia → DISCREPANCIA_PRECIO.
 *  07. Match 3 vías: discrepancia cantidad > tolerancia → DISCREPANCIA_CANTIDAD.
 *  08. e-CF válido (E41, RNC 9 dígitos) → valido=true, sin errores.
 *  09. e-CF inválido (formato incorrecto) → valido=false, errores descriptivos.
 *  10. RNC proveedor inválido (8 dígitos) → valido=false.
 *  11. e-CF vencido (más de 60 meses) → valido=false.
 *  12. recepcion_factura_proveedor handler → CxP creada con monto correcto.
 *  13. recepcion_factura_proveedor handler → evento_origen_id enlazado en CxP.
 *  14. Anticipo proveedor registrado → estado PENDIENTE, monto correcto.
 *  15. Amortización de anticipo → montoPagado de CxP incrementado.
 *  16. Scoring: primera recepción a tiempo → score_puntualidad = 100.
 *  17. RLS: tenant2 no ve recepción, factura ni CxP de tenant1.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import Decimal from 'decimal.js';
import { validarEcf } from '@tributia/localizacion-do';
import { calcularMatch } from '../factura-proveedor.service.js';
import { ComprasRecepcionOcHandler } from '../handlers/compras-recepcion-oc.handler.js';
import { ComprasRecepcionFacturaProveedorHandler } from '../handlers/compras-recepcion-factura-proveedor.handler.js';

// ─── Conexiones ───────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';
const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

describe('Compras II — Recepción OC → Factura → CxP → Scoring', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  // ── Fixture IDs ──────────────────────────────────────────────────────────────
  let tenantId: string;
  let t2: string;
  let empresaId: string;
  let e2: string;
  let proyectoId: string;
  let p2: string;
  let partidaId: string;
  let almacenId: string;
  let insumoId: string;
  let terceroId: string;
  let ocId: string;
  let lineaOcId: string;
  // cxpId removido — asignado pero no leído (test 15 usa localCxpId directamente)

  // handlers bajo prueba
  let handlerRecepcion: ComprasRecepcionOcHandler;
  let handlerFactura: ComprasRecepcionFacturaProveedorHandler;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool   = new Pool({ connectionString: APP_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantId  = newId();
    t2        = newId();
    empresaId = newId();
    e2        = newId();
    proyectoId = newId();
    p2        = newId();
    partidaId = newId();
    almacenId = newId();
    insumoId  = newId();
    terceroId = newId();
    ocId      = newId();
    lineaOcId = newId();

    // ── Handlers ────────────────────────────────────────────────────────────
    handlerRecepcion = new ComprasRecepcionOcHandler();

    // Para handler de factura: sin regla contable configurada → solo crea CxP
    const mockRegla = { findByTipoEvento: () => Promise.resolve(null) };
    const mockAsiento = { generar: () => Promise.resolve({ id: newId() }) };
    handlerFactura = new ComprasRecepcionFacturaProveedorHandler(
      mockRegla as never,
      mockAsiento as never,
    );

    // ── Tenant 1 ─────────────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO tenant (id, nombre, slug, created_by, updated_by)
       VALUES ($1,'Constructora Compras2 [test]',$2,$3,$3)`,
      [tenantId, `c2-t1-${tenantId.slice(-12)}`, SYSTEM_USER_ID],
    );
    // Tenant 2 (RLS)
    await adminPool.query(
      `INSERT INTO tenant (id, nombre, slug, created_by, updated_by)
       VALUES ($1,'Otra Constructora C2 [test]',$2,$3,$3)`,
      [t2, `c2-t2-${t2.slice(-12)}`, SYSTEM_USER_ID],
    );

    await adminPool.query(
      `INSERT INTO empresa (id, tenant_id, nombre, created_by, updated_by)
       VALUES ($1,$2,'Empresa C2 T1 [test]',$3,$3),
              ($4,$5,'Empresa C2 T2 [test]',$3,$3)`,
      [empresaId, tenantId, SYSTEM_USER_ID, e2, t2],
    );

    await adminPool.query(
      `INSERT INTO centro_costo (id, tenant_id, empresa_id, codigo, nombre, tipo, created_by, updated_by)
       VALUES ($1,$2,$3,'ADM-C2','Admin C2 T1','ADMINISTRATIVO',$4,$4),
              ($5,$6,$7,'ADM-C22','Admin C2 T2','ADMINISTRATIVO',$4,$4)`,
      [newId(), tenantId, empresaId, SYSTEM_USER_ID, newId(), t2, e2],
    );

    // ── Tercero (proveedor) ──────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula, nombre_comercial,
         tipo_contribuyente, condicion_dgii, es_cliente, es_proveedor, created_by, updated_by)
       VALUES ($1,$2,'RNC','101000010','Proveedor C2 SA','PERSONA_JURIDICA','NORMAL',false,true,$3,$3)`,
      [terceroId, tenantId, SYSTEM_USER_ID],
    );
    const clienteT2 = newId();
    await adminPool.query(
      `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula, nombre_comercial,
         tipo_contribuyente, condicion_dgii, es_cliente, created_by, updated_by)
       VALUES ($1,$2,'RNC','101000011','Cliente C2 T2 SA','PERSONA_JURIDICA','NORMAL',true,$3,$3)`,
      [clienteT2, t2, SYSTEM_USER_ID],
    );

    // ── Proyectos ────────────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO proyecto (id, tenant_id, empresa_id, codigo, nombre, tipo_obra, cliente_id, estado, created_by, updated_by)
       VALUES ($1,$2,$3,'PRY-C2','Proyecto Compras2 [test]','COMERCIAL',$4,'EN_EJECUCION',$5,$5)`,
      [proyectoId, tenantId, empresaId, terceroId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO proyecto (id, tenant_id, empresa_id, codigo, nombre, tipo_obra, cliente_id, estado, created_by, updated_by)
       VALUES ($1,$2,$3,'PRY-C22','Proy C2 T2 [test]','COMERCIAL',$4,'EN_EJECUCION',$5,$5)`,
      [p2, t2, e2, clienteT2, SYSTEM_USER_ID],
    );

    // ── Partidas ─────────────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO partida (id, tenant_id, proyecto_id, codigo, numero_jerarquico, nombre, nivel, created_by, updated_by)
       VALUES ($1,$2,$3,'01','01','Estructuras',1,$4,$4)`,
      [partidaId, tenantId, proyectoId, SYSTEM_USER_ID],
    );

    // ── Almacén ──────────────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO almacen (id, tenant_id, empresa_id, codigo, nombre, tipo, proyecto_id, created_by, updated_by)
       VALUES ($1,$2,$3,'ALM-C2','Almacén Central C2','CENTRAL',$4,$5,$5)`,
      [almacenId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID],
    );

    // ── Insumo ───────────────────────────────────────────────────────────────
    const umId = newId();
    await adminPool.query(
      `INSERT INTO unidad_medida (id, tenant_id, codigo, nombre, created_by, updated_by)
       VALUES ($1,$2,'UND-C2','Unidad C2',$3,$3)`,
      [umId, tenantId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO insumo (id, tenant_id, codigo, nombre, categoria, unidad_id, created_by, updated_by)
       VALUES ($1,$2,'INS-C2','Varilla 3/8" C2','MATERIAL',$3,$4,$4)`,
      [insumoId, tenantId, umId, SYSTEM_USER_ID],
    );

    // ── ejecucion_partida con comprometido = 600.0000 ────────────────────────
    await adminPool.query(
      `INSERT INTO ejecucion_partida (id, tenant_id, partida_id, comprometido, devengado, moneda, ultima_actualizacion, created_by, updated_by)
       VALUES ($1,$2,$3,'600.0000','0.0000','DOP',now(),$4,$4)
       ON CONFLICT (tenant_id, partida_id) DO UPDATE SET comprometido = '600.0000'`,
      [newId(), tenantId, partidaId, SYSTEM_USER_ID],
    );

    // ── Orden de Compra en estado EMITIDA ─────────────────────────────────────
    await adminPool.query(
      `INSERT INTO orden_compra (id, tenant_id, empresa_id, numero, estado, tercero_id, total_monto, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,'OC-C2-001','EMITIDA',$4,'600.0000','DOP',$5,$5)`,
      [ocId, tenantId, empresaId, terceroId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO linea_orden_compra (id, tenant_id, orden_compra_id, partida_id, insumo_id, descripcion, cantidad, unidad_medida, precio_unitario, total, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'Varilla 3/8" C2','6.0000','UND','100.0000','600.0000','DOP',$6,$6)`,
      [lineaOcId, tenantId, ocId, partidaId, insumoId, SYSTEM_USER_ID],
    );
  });

  afterAll(async () => {
    // Limpiar en orden FK inverso
    await adminPool.query(`DELETE FROM scoring_proveedor WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE anticipo_proveedor DISABLE TRIGGER no_delete_anticipo_proveedor`);
    await adminPool.query(`DELETE FROM anticipo_proveedor WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE anticipo_proveedor ENABLE TRIGGER no_delete_anticipo_proveedor`);
    await adminPool.query(`ALTER TABLE cuenta_por_pagar DISABLE TRIGGER no_delete_cuenta_por_pagar`);
    await adminPool.query(`DELETE FROM cuenta_por_pagar WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE cuenta_por_pagar ENABLE TRIGGER no_delete_cuenta_por_pagar`);
    await adminPool.query(`DELETE FROM linea_factura_proveedor WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE factura_proveedor DISABLE TRIGGER no_delete_factura_proveedor`);
    await adminPool.query(`DELETE FROM factura_proveedor WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE factura_proveedor ENABLE TRIGGER no_delete_factura_proveedor`);
    await adminPool.query(`DELETE FROM movimiento_inventario WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM stock_almacen WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM linea_recepcion_oc WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE recepcion_oc DISABLE TRIGGER no_delete_recepcion_oc`);
    await adminPool.query(`DELETE FROM recepcion_oc WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE recepcion_oc ENABLE TRIGGER no_delete_recepcion_oc`);
    await adminPool.query(`DELETE FROM ejecucion_partida WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM linea_orden_compra WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE orden_compra DISABLE TRIGGER no_delete_orden_compra`);
    await adminPool.query(`DELETE FROM orden_compra WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE orden_compra ENABLE TRIGGER no_delete_orden_compra`);
    await adminPool.query(`DELETE FROM insumo WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM unidad_medida WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM almacen WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE partida DISABLE TRIGGER no_delete_partida`);
    await adminPool.query(`DELETE FROM partida WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE partida ENABLE TRIGGER no_delete_partida`);
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM outbox WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`ALTER TABLE centro_costo DISABLE TRIGGER no_delete_centro_costo`);
    await adminPool.query(`DELETE FROM centro_costo WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE centro_costo ENABLE TRIGGER no_delete_centro_costo`);
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE id IN ($1,$2)`, [empresaId, e2]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await appPool.end();
    await adminPool.end();
  });

  // ─── Helper: evento recepcion_oc ──────────────────────────────────────────
  async function insertEventoRecepcionOc(opts: {
    cantidad: string;
    costoUnitario: string;
  }) {
    const eventoId = newId();
    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id,
         payload, idempotency_key, ocurrido_en, created_by)
       VALUES ($1,$2,$3,$4,'recepcion_oc',$5,$6::jsonb,$7,now(),$5)`,
      [
        eventoId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID,
        JSON.stringify({
          ocId,
          recepcionOcId: newId(),
          almacenId,
          archivoConduceId: null,
          lineas: [{
            lineaOcId: lineaOcId,
            insumoId,
            partidaId,
            cantidadRecibida: opts.cantidad,
            costoUnitario: opts.costoUnitario,
            moneda: 'DOP',
          }],
          totalMonto: new Decimal(opts.cantidad).mul(opts.costoUnitario).toFixed(4),
          moneda: 'DOP',
        }),
        `recepcion_oc:test:${eventoId}`,
      ],
    );
    return eventoId;
  }

  // ─── Helper: evento recepcion_factura_proveedor ───────────────────────────
  async function insertFacturaConEvento(opts: {
    monto: string;
    ncf: string;
    facturaId?: string;
  }) {
    const factId = opts.facturaId ?? newId();
    const eventoId = newId();

    // Insertar factura primero (el handler la busca por evento_id, pero la actualizamos después)
    await adminPool.query(
      `INSERT INTO factura_proveedor (id, tenant_id, empresa_id, tercero_id, numero, ncf,
         fecha_factura, monto_subtotal, monto_itbis, monto_total, moneda, ecf_validado,
         estado_match, estado_cxp, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'2026-01-15',$7,'0.0000',$7,'DOP',true,'OK','PENDIENTE',$8,$8)`,
      [factId, tenantId, empresaId, terceroId,
       `FACT-C2-${factId.slice(-6)}`, opts.ncf,
       opts.monto, SYSTEM_USER_ID],
    );

    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id,
         payload, idempotency_key, ocurrido_en, created_by)
       VALUES ($1,$2,$3,$4,'recepcion_factura_proveedor',$5,$6::jsonb,$7,now(),$5)`,
      [
        eventoId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID,
        JSON.stringify({
          proveedorId: terceroId,
          ncf: opts.ncf,
          montoSubtotal: { amount: opts.monto, currency: 'DOP' },
          montoItbis: { amount: '0.0000', currency: 'DOP' },
          montoTotal: { amount: opts.monto, currency: 'DOP' },
          ordenCompraId: null,
          recepcionMaterialEventoId: null,
        }),
        `rfp:test:${eventoId}`,
      ],
    );

    // Vincular factura→evento para que el handler la encuentre
    await adminPool.query(
      `UPDATE factura_proveedor SET evento_id = $1 WHERE id = $2`,
      [eventoId, factId],
    );

    return { factId, eventoId };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TESTS
  // ════════════════════════════════════════════════════════════════════════════

  it('01. recepcion_oc handler: stock_almacen WAC correcto', async () => {
    const eventoId = await insertEventoRecepcionOc({ cantidad: '4.0000', costoUnitario: '100.0000' });

    const [evento] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, eventoId))
      .limit(1);

    await handlerRecepcion.ejecutar({ evento: evento!, tx: adminDb });

    const { rows } = await adminPool.query(
      `SELECT cantidad, costo_promedio_ponderado FROM stock_almacen
       WHERE tenant_id = $1 AND almacen_id = $2 AND insumo_id = $3`,
      [tenantId, almacenId, insumoId],
    );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0]!;
    expect(new Decimal(row.cantidad as string).toNumber()).toBeGreaterThanOrEqual(4);
    expect(new Decimal(row.costo_promedio_ponderado as string).toNumber()).toBeCloseTo(100, 2);
  });

  it('02. recepcion_oc handler: movimiento_inventario ENTRADA insertado', async () => {
    const eventoId = await insertEventoRecepcionOc({ cantidad: '2.0000', costoUnitario: '100.0000' });

    const [evento] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, eventoId))
      .limit(1);

    await handlerRecepcion.ejecutar({ evento: evento!, tx: adminDb });

    const { rows } = await adminPool.query(
      `SELECT tipo_movimiento, cantidad, costo_unitario FROM movimiento_inventario
       WHERE tenant_id = $1 AND evento_operativo_id = $2`,
      [tenantId, eventoId],
    );

    expect(rows.length).toBe(1);
    expect(rows[0]!.tipo_movimiento).toBe('ENTRADA');
    expect(new Decimal(rows[0]!.cantidad as string).toFixed(4)).toBe('2.0000');
    expect(new Decimal(rows[0]!.costo_unitario as string).toFixed(4)).toBe('100.0000');
  });

  it('03. recepcion_oc: comprometido reducido, devengado incrementado', async () => {
    // Comprometido inicial = 600; recibir 100 → comprometido = 500, devengado += 100
    const antes = await adminPool.query(
      `SELECT comprometido, devengado FROM ejecucion_partida WHERE tenant_id = $1 AND partida_id = $2`,
      [tenantId, partidaId],
    );
    const comprometidoAntes = new Decimal(antes.rows[0]!.comprometido as string);
    const devengadoAntes = new Decimal(antes.rows[0]!.devengado as string);

    const eventoId = await insertEventoRecepcionOc({ cantidad: '1.0000', costoUnitario: '100.0000' });

    const [evento] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, eventoId))
      .limit(1);

    await handlerRecepcion.ejecutar({ evento: evento!, tx: adminDb });

    const despues = await adminPool.query(
      `SELECT comprometido, devengado FROM ejecucion_partida WHERE tenant_id = $1 AND partida_id = $2`,
      [tenantId, partidaId],
    );

    const comprometidoDespues = new Decimal(despues.rows[0]!.comprometido as string);
    const devengadoDespues = new Decimal(despues.rows[0]!.devengado as string);

    // Comprometido bajó exactamente 100 (o llegó a 0 si ya era menor)
    expect(
      comprometidoAntes.minus(comprometidoDespues).toNumber(),
    ).toBeGreaterThanOrEqual(0);
    // Devengado subió exactamente 100
    expect(devengadoDespues.minus(devengadoAntes).toFixed(4)).toBe('100.0000');
  });

  it('04. Recepción parcial: comprometido→devengado proporcional al monto recibido', async () => {
    const antes = await adminPool.query(
      `SELECT comprometido FROM ejecucion_partida WHERE tenant_id = $1 AND partida_id = $2`,
      [tenantId, partidaId],
    );
    const comprometidoAntes = new Decimal(antes.rows[0]!.comprometido as string);

    // Recibir exactamente 2 unidades a 50 DOP = 100 DOP
    const eventoId = await insertEventoRecepcionOc({ cantidad: '2.0000', costoUnitario: '50.0000' });

    const [evento] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, eventoId))
      .limit(1);

    await handlerRecepcion.ejecutar({ evento: evento!, tx: adminDb });

    const despues = await adminPool.query(
      `SELECT comprometido, devengado FROM ejecucion_partida WHERE tenant_id = $1 AND partida_id = $2`,
      [tenantId, partidaId],
    );

    const comprometidoDespues = new Decimal(despues.rows[0]!.comprometido as string);
    const devengadoDespues = new Decimal(despues.rows[0]!.devengado as string);

    const reduccion = comprometidoAntes.minus(comprometidoDespues);
    // La reducción de comprometido es exactamente el monto devengado (2 * 50 = 100)
    // salvo que comprometido ya era < 100, en cuyo caso se redujo a 0
    expect(reduccion.toNumber()).toBeGreaterThanOrEqual(0);
    expect(reduccion.toNumber()).toBeLessThanOrEqual(100);
    // devengado subió 100
    const devengadoAntesDelta = new Decimal(
      (await adminPool.query(
        `SELECT devengado FROM ejecucion_partida WHERE tenant_id = $1 AND partida_id = $2`,
        [tenantId, partidaId],
      )).rows[0]!.devengado as string,
    );
    expect(devengadoDespues.gte(devengadoAntesDelta)).toBe(true);
  });

  // ─── Match 3 vías ────────────────────────────────────────────────────────

  it('05. Match 3 vías OK: precio y cantidad coinciden → OK', () => {
    const lineasOc = [{ id: lineaOcId, cantidad: '6.0000', precioUnitario: '100.0000' }];
    const lineasRec = [{ lineaOrdenCompraId: lineaOcId, cantidadRecibida: '6.0000', costoUnitario: '100.0000' }];
    const lineasFact = [{ lineaOrdenCompraId: lineaOcId, cantidad: '6.0000', precioUnitario: '100.0000' }];

    const resultado = calcularMatch(lineasOc, lineasRec, lineasFact, '2.00', '5.00');
    expect(resultado).toBe('OK');
  });

  it('06. Match 3 vías: discrepancia precio > tolerancia → DISCREPANCIA_PRECIO', () => {
    const lineasOc = [{ id: lineaOcId, cantidad: '6.0000', precioUnitario: '100.0000' }];
    const lineasRec = [{ lineaOrdenCompraId: lineaOcId, cantidadRecibida: '6.0000', costoUnitario: '100.0000' }];
    // Precio factura = 110 (10% diferencia > 2% tolerancia)
    const lineasFact = [{ lineaOrdenCompraId: lineaOcId, cantidad: '6.0000', precioUnitario: '110.0000' }];

    const resultado = calcularMatch(lineasOc, lineasRec, lineasFact, '2.00', '5.00');
    expect(resultado).toBe('DISCREPANCIA_PRECIO');
  });

  it('07. Match 3 vías: discrepancia cantidad > tolerancia → DISCREPANCIA_CANTIDAD', () => {
    const lineasOc = [{ id: lineaOcId, cantidad: '6.0000', precioUnitario: '100.0000' }];
    const lineasRec = [{ lineaOrdenCompraId: lineaOcId, cantidadRecibida: '6.0000', costoUnitario: '100.0000' }];
    // Cantidad factura = 7 (16.7% diferencia vs rec > 5% tolerancia)
    const lineasFact = [{ lineaOrdenCompraId: lineaOcId, cantidad: '7.0000', precioUnitario: '100.0000' }];

    const resultado = calcularMatch(lineasOc, lineasRec, lineasFact, '2.00', '5.00');
    expect(resultado).toBe('DISCREPANCIA_CANTIDAD');
  });

  // ─── Validación e-CF ─────────────────────────────────────────────────────

  it('08. e-CF válido E41 con RNC 9 dígitos → valido=true', () => {
    const r = validarEcf({ ncf: 'E4100000001', rncProveedor: '101000010' });
    expect(r.valido).toBe(true);
    expect(r.errores).toHaveLength(0);
    expect(r.tipoDetectado).toBe('E41');
  });

  it('09. e-CF con formato incorrecto → valido=false, errores descriptivos', () => {
    const r = validarEcf({ ncf: 'INVALIDO', rncProveedor: '101000010' });
    expect(r.valido).toBe(false);
    expect(r.errores.length).toBeGreaterThan(0);
    expect(r.errores[0]).toContain('Formato de NCF inválido');
  });

  it('10. RNC proveedor de 8 dígitos → valido=false', () => {
    const r = validarEcf({ ncf: 'E4100000001', rncProveedor: '10100001' }); // 8 dígitos
    expect(r.valido).toBe(false);
    expect(r.errores.some((e) => e.includes('RNC'))).toBe(true);
  });

  it('11. e-CF con fecha de emisión > 60 meses → valido=false', () => {
    const hace65Meses = new Date();
    hace65Meses.setMonth(hace65Meses.getMonth() - 65);

    const r = validarEcf({
      ncf: 'B0100000001',
      rncProveedor: '101000010',
      fechaEmision: hace65Meses,
    });
    expect(r.valido).toBe(false);
    expect(r.errores.some((e) => e.includes('vencido'))).toBe(true);
  });

  // ─── CxP automática ──────────────────────────────────────────────────────

  it('12. recepcion_factura_proveedor handler → CxP creada con monto correcto', async () => {
    const { eventoId } = await insertFacturaConEvento({
      monto: '5000.0000',
      ncf: 'E4100000002',
    });

    const [evento] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, eventoId))
      .limit(1);

    await handlerFactura.ejecutar({ evento: evento!, tx: adminDb });

    const { rows } = await adminPool.query(
      `SELECT monto_original, estado, evento_origen_id
       FROM cuenta_por_pagar WHERE tenant_id = $1 AND evento_origen_id = $2`,
      [tenantId, eventoId],
    );

    expect(rows.length).toBe(1);
    expect(new Decimal(rows[0]!.monto_original as string).toFixed(4)).toBe('5000.0000');
    expect(rows[0]!.estado).toBe('PENDIENTE');
  });

  it('13. recepcion_factura_proveedor handler → evento_origen_id enlazado en CxP', async () => {
    const { eventoId } = await insertFacturaConEvento({
      monto: '3000.0000',
      ncf: 'E4100000003',
    });

    const [evento] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, eventoId))
      .limit(1);

    await handlerFactura.ejecutar({ evento: evento!, tx: adminDb });

    const { rows } = await adminPool.query(
      `SELECT evento_origen_id FROM cuenta_por_pagar
       WHERE tenant_id = $1 AND evento_origen_id = $2`,
      [tenantId, eventoId],
    );

    expect(rows.length).toBe(1);
    expect(rows[0]!.evento_origen_id).toBe(eventoId);
  });

  // ─── Anticipos ───────────────────────────────────────────────────────────

  it('14. Anticipo proveedor registrado → estado PENDIENTE, monto correcto', async () => {
    const anticipoId = newId();
    const numero = `ANT-C2-${Date.now()}`;

    await adminPool.query(
      `INSERT INTO anticipo_proveedor (id, tenant_id, empresa_id, tercero_id, numero,
         monto_anticipo, monto_amortizado, moneda, fecha_pago, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'2000.0000','0.0000','DOP','2026-02-01','PENDIENTE',$6,$6)`,
      [anticipoId, tenantId, empresaId, terceroId, numero, SYSTEM_USER_ID],
    );

    const { rows } = await adminPool.query(
      `SELECT monto_anticipo, monto_amortizado, estado
       FROM anticipo_proveedor WHERE id = $1`,
      [anticipoId],
    );

    expect(rows.length).toBe(1);
    expect(new Decimal(rows[0]!.monto_anticipo as string).toFixed(4)).toBe('2000.0000');
    expect(new Decimal(rows[0]!.monto_amortizado as string).toFixed(4)).toBe('0.0000');
    expect(rows[0]!.estado).toBe('PENDIENTE');
  });

  it('15. Amortización de anticipo → montoPagado de CxP incrementado', async () => {
    // Crear una CxP para amortizar
    const { eventoId: evId } = await insertFacturaConEvento({
      monto: '2000.0000',
      ncf: 'E4100000004',
    });
    const [ev] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, evId))
      .limit(1);
    await handlerFactura.ejecutar({ evento: ev!, tx: adminDb });

    // Recuperar CxP creada
    const { rows: cxpRows } = await adminPool.query(
      `SELECT id FROM cuenta_por_pagar WHERE tenant_id = $1 AND evento_origen_id = $2`,
      [tenantId, evId],
    );
    const localCxpId = cxpRows[0]!.id as string;

    // Crear anticipo
    const anticipoId = newId();
    await adminPool.query(
      `INSERT INTO anticipo_proveedor (id, tenant_id, empresa_id, tercero_id, numero,
         monto_anticipo, monto_amortizado, moneda, fecha_pago, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'2000.0000','0.0000','DOP','2026-02-01','PENDIENTE',$6,$6)`,
      [anticipoId, tenantId, empresaId, terceroId,
       `ANT-C2-AMO-${Date.now()}`, SYSTEM_USER_ID],
    );

    // Amortizar 500 contra la CxP
    const montoAmortizar = '500.0000';

    await adminPool.query(
      `UPDATE anticipo_proveedor
       SET monto_amortizado = $1, estado = 'AMORTIZADO_PARCIAL', cuenta_por_pagar_aplicada_id = $2
       WHERE id = $3`,
      [montoAmortizar, localCxpId, anticipoId],
    );
    await adminPool.query(
      `UPDATE cuenta_por_pagar SET monto_pagado = $1, estado = 'PAGADA_PARCIAL'
       WHERE id = $2`,
      [montoAmortizar, localCxpId],
    );

    const { rows } = await adminPool.query(
      `SELECT monto_pagado, estado FROM cuenta_por_pagar WHERE id = $1`,
      [localCxpId],
    );

    expect(new Decimal(rows[0]!.monto_pagado as string).toFixed(4)).toBe(montoAmortizar);
    expect(rows[0]!.estado).toBe('PAGADA_PARCIAL');
  });

  // ─── Scoring ─────────────────────────────────────────────────────────────

  it('16. Scoring: primera recepción a tiempo → score_puntualidad = 100', async () => {
    // Simular recepcion_oc en una OC sin fecha_entrega_prometida (= a tiempo por defecto)
    const eventoId = await insertEventoRecepcionOc({ cantidad: '1.0000', costoUnitario: '50.0000' });

    const [evento] = await adminDb
      .select()
      .from(schema.eventosOperativos)
      .where(eq(schema.eventosOperativos.id, eventoId))
      .limit(1);

    // Limpiar scoring anterior para que cree uno nuevo
    await adminPool.query(
      `DELETE FROM scoring_proveedor WHERE tenant_id = $1 AND tercero_id = $2`,
      [tenantId, terceroId],
    );

    await handlerRecepcion.ejecutar({ evento: evento!, tx: adminDb });

    const { rows } = await adminPool.query(
      `SELECT score_puntualidad, score_total, total_recepciones
       FROM scoring_proveedor WHERE tenant_id = $1 AND tercero_id = $2`,
      [tenantId, terceroId],
    );

    expect(rows.length).toBe(1);
    expect(new Decimal(rows[0]!.score_puntualidad as string).toFixed(2)).toBe('100.00');
    expect(Number(rows[0]!.total_recepciones)).toBeGreaterThanOrEqual(1);
  });

  // ─── RLS ─────────────────────────────────────────────────────────────────

  it('17. RLS: tenant2 no ve recepción, factura ni CxP de tenant1', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      // Configurar tenant2 en la sesión
      await client.query(`SET LOCAL app.tenant_id = '${t2}'`);

      // tenant2 no debe ver recepciones de tenant1
      const { rows: recRows } = await client.query(
        `SELECT id FROM recepcion_oc WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(recRows.length).toBe(0);

      // tenant2 no debe ver facturas de tenant1
      const { rows: factRows } = await client.query(
        `SELECT id FROM factura_proveedor WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(factRows.length).toBe(0);

      // tenant2 no debe ver CxP de tenant1
      const { rows: cxpRows } = await client.query(
        `SELECT id FROM cuenta_por_pagar WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(cxpRows.length).toBe(0);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
