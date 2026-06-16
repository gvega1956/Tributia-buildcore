/**
 * FLUJO CANÓNICO §5 — Prueba e2e de extremo a extremo
 *
 * Escenario: una constructora recibe material vía OC, lo consume en obra,
 * reporta avance y el tablero reconcilia la tríada y el Valor Ganado.
 *
 * Cadena:
 *   emision_oc → comprometido
 *   recepcion_oc → comprometido→devengado + stock WAC + movimiento ENTRADA
 *   consumo_material → stock↓ + asiento contable (DB 5101 / CR 1104)
 *   avance_partida → avanceCantidad
 *   Tríada: comprometido + devengado + disponible = presupuestoVigente
 *   EVM: EV = presupuestoVigente × (avanceCantidad / cantidadPresupuestada)
 *         CPI = EV / AC (AC = devengado)
 *   Asiento: Σdebe = Σhaber exactamente para el evento consumo_material
 *
 * Números concretos:
 *   Partida "Hormigón": 100 m³ presupuestados × DOP 500 = DOP 50,000 vigente
 *   OC: 60 m³ × DOP 480/m³ = DOP 28,800 → comprometido
 *   Recepción OC: 60 m³ × DOP 480 = DOP 28,800 → comprometido→devengado, WAC=480
 *   Consumo: 40 m³ × WAC 480 = DOP 19,200 → stock↓ + asiento
 *   Avance: 30 m³ ejecutados
 *   presupuestoVigente = 50,000; comprometido = 0 (ya devengado); devengado = 28,800
 *   disponible = 50,000 − 0 − 28,800 = 21,200
 *   EV = 50,000 × (30/100) = 15,000
 *   AC = 28,800 (devengado)
 *   CPI = 15,000 / 28,800 ≈ 0.5208
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import Decimal from 'decimal.js';

import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';

import { ComprasEmisionOcHandler } from '../../compras/handlers/compras-emision-oc.handler.js';
import { ComprasRecepcionOcHandler } from '../../compras/handlers/compras-recepcion-oc.handler.js';
import { InventarioConsumoMaterialHandler } from '../../inventario/handlers/inventario-consumo-material.handler.js';
import { ContabilidadConsumoMaterialHandler } from '../../contabilidad/handlers/contabilidad-consumo-material.handler.js';
import { ObraAvancePartidaHandler } from '../../obra/handlers/obra-avance-partida.handler.js';
import { ReglaContableService } from '../../contabilidad/regla-contable.service.js';
import { AsientoContableService } from '../../contabilidad/asiento-contable.service.js';
import { CuentaContableService } from '../../contabilidad/cuenta-contable.service.js';
import type { ConfiguracionRegla } from '@tributia/contabilidad';

// ─── Conexiones ───────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

// ─── Constantes del escenario ─────────────────────────────────────────────────
const CANTIDAD_PRES    = '100.0000'; // m³ presupuestados
const PRECIO_PRES      = '500.0000'; // DOP/m³
const TOTAL_PRES       = '50000.0000'; // presupuestoVigente
const CANTIDAD_OC      = '60.0000';  // m³ en la OC
const PRECIO_OC        = '480.0000'; // DOP/m³
const TOTAL_OC         = '28800.0000';
const CANTIDAD_CONSUMO = '40.0000';  // m³ consumidos
const COSTO_CONSUMO    = '19200.0000'; // 40 × 480
const CANTIDAD_AVANCE  = '30.0000';  // m³ reportados
// tríada esperada
const EXP_COMPROMETIDO = '0.0000';   // toda la OC ya fue devengada
const EXP_DEVENGADO    = '28800.0000';
const EXP_DISPONIBLE   = '21200.0000'; // 50000 − 0 − 28800
// EVM
const EXP_EV = new Decimal(TOTAL_PRES)
  .mul(new Decimal(CANTIDAD_AVANCE).div(new Decimal(CANTIDAD_PRES)));  // 15,000
const EXP_CPI = EXP_EV.div(new Decimal(EXP_DEVENGADO));               // 0.5208…

// ─── Suite ────────────────────────────────────────────────────────────────────
describe('Flujo Canónico §5 — OC→Recepción→Consumo→Avance→Tríada→EVM→Asiento', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  // IDs del escenario
  let tenantId: string;
  let empresaId: string;
  let proyectoId: string;
  let centroCostoId: string;
  let terceroId: string;
  let partidaId: string;
  let versionPresupId: string;
  let lineaPresupId: string;
  let almacenId: string;
  let insumoId: string;
  let unidadId: string;
  let ocId: string;
  let lineaOcId: string;
  let recepcionOcId: string;

  // IDs de cuentas contables
  let cuentaGastoId: string;     // 5101 Costo materiales directo
  let cuentaInventarioId: string; // 1104 Inventario materiales

  let reglaConsumoId: string;

  // Servicios reales (sin NestJS DI)
  let reglaSvc: ReglaContableService;
  let asientoSvc: AsientoContableService;
  let contabConsumoHandler: ContabilidadConsumoMaterialHandler;

  // Handlers
  let emisionOcHandler: ComprasEmisionOcHandler;
  let recepcionOcHandler: ComprasRecepcionOcHandler;
  let consumoHandler: InventarioConsumoMaterialHandler;
  let avanceHandler: ObraAvancePartidaHandler;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb   = drizzle(adminPool, { schema });

    // Generar IDs
    tenantId         = newId();
    empresaId        = newId();
    proyectoId       = newId();
    centroCostoId    = newId();
    terceroId        = newId();
    partidaId        = newId();
    versionPresupId  = newId();
    lineaPresupId    = newId();
    almacenId        = newId();
    insumoId         = newId();
    unidadId         = newId();
    ocId             = newId();
    lineaOcId        = newId();
    recepcionOcId    = newId();
    cuentaGastoId    = newId();
    cuentaInventarioId = newId();
    reglaConsumoId   = newId();

    // Instanciar servicios (DbService no se inyecta aquí, tx se pasa a findByTipoEvento)
    reglaSvc   = new ReglaContableService();
    const cuentaSvc = new CuentaContableService(null as never);
    asientoSvc = new AsientoContableService(null as never, cuentaSvc);

    contabConsumoHandler = new ContabilidadConsumoMaterialHandler(reglaSvc, asientoSvc);
    emisionOcHandler     = new ComprasEmisionOcHandler();
    recepcionOcHandler   = new ComprasRecepcionOcHandler();
    consumoHandler       = new InventarioConsumoMaterialHandler();
    avanceHandler        = new ObraAvancePartidaHandler();

    // ── Tenant, empresa, infraestructura ─────────────────────────────────────
    await adminDb.insert(schema.tenants).values({
      id: tenantId,
      nombre: 'Constructora FC [test]',
      slug: `fc-${tenantId.slice(-12)}`,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await adminDb.insert(schema.empresas).values({
      id: empresaId,
      tenantId,
      nombre: 'Empresa FC [test]',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await adminPool.query(
      `INSERT INTO centro_costo (id, tenant_id, empresa_id, codigo, nombre, tipo, created_by, updated_by)
       VALUES ($1,$2,$3,'FC-ADM','Admin FC','ADMINISTRATIVO',$4,$4)`,
      [centroCostoId, tenantId, empresaId, SYSTEM_USER_ID],
    );

    // ── Tercero (cliente y proveedor) ─────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula, nombre_comercial, tipo_contribuyente, condicion_dgii, es_cliente, es_proveedor, created_by, updated_by)
       VALUES ($1,$2,'RNC','102000001','Proveedor FC SA','PERSONA_JURIDICA','NORMAL',true,true,$3,$3)`,
      [terceroId, tenantId, SYSTEM_USER_ID],
    );

    // ── Proyecto ──────────────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO proyecto (id, tenant_id, empresa_id, codigo, nombre, tipo_obra, cliente_id, estado, created_by, updated_by)
       VALUES ($1,$2,$3,'FC-001','Edificio Flujo Canónico','RESIDENCIAL',$4,'EN_EJECUCION',$5,$5)`,
      [proyectoId, tenantId, empresaId, terceroId, SYSTEM_USER_ID],
    );

    // ── Partida (100 m³ de hormigón presupuestados) ───────────────────────────
    await adminPool.query(
      `INSERT INTO partida (id, tenant_id, proyecto_id, codigo, numero_jerarquico, nombre, nivel, cantidad_presupuestada, created_by, updated_by)
       VALUES ($1,$2,$3,'01','01','Hormigón estructural',1,$4,$5,$5)`,
      [partidaId, tenantId, proyectoId, CANTIDAD_PRES, SYSTEM_USER_ID],
    );

    // ── Presupuesto BASE APROBADO: 100 m³ × 500 = 50,000 ────────────────────
    await adminPool.query(
      `INSERT INTO version_presupuesto (id, tenant_id, proyecto_id, nombre, tipo, estado, moneda, total_directo, total_presupuesto, created_by, updated_by)
       VALUES ($1,$2,$3,'Presupuesto Ejecutivo','BASE','PENDIENTE','DOP',50000,50000,$4,$4)`,
      [versionPresupId, tenantId, proyectoId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO linea_presupuesto (id, tenant_id, version_presupuesto_id, partida_id, cantidad, precio_unitario, total, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'DOP',$8,$8)`,
      [lineaPresupId, tenantId, versionPresupId, partidaId, CANTIDAD_PRES, PRECIO_PRES, TOTAL_PRES, SYSTEM_USER_ID],
    );
    // Aprobar (trigger no permite INSERT en APROBADO, pero sí UPDATE)
    await adminPool.query(
      `UPDATE version_presupuesto SET estado = 'APROBADO' WHERE id = $1`,
      [versionPresupId],
    );

    // ── Unidad de medida, almacén e insumo ───────────────────────────────────
    await adminPool.query(
      `INSERT INTO unidad_medida (id, tenant_id, codigo, nombre, created_by, updated_by)
       VALUES ($1,$2,'M3','Metro cúbico',$3,$3)`,
      [unidadId, tenantId, SYSTEM_USER_ID],
    );

    await adminPool.query(
      `INSERT INTO almacen (id, tenant_id, empresa_id, codigo, nombre, tipo, created_by, updated_by)
       VALUES ($1,$2,$3,'ALM-FC','Almacén Central FC','CENTRAL',$4,$4)`,
      [almacenId, tenantId, empresaId, SYSTEM_USER_ID],
    );

    await adminPool.query(
      `INSERT INTO insumo (id, tenant_id, codigo, nombre, unidad_id, categoria, created_by, updated_by)
       VALUES ($1,$2,'INS-HOR','Hormigon Fc=3000 PSI',$3,'MATERIAL',$4,$4)`,
      [insumoId, tenantId, unidadId, SYSTEM_USER_ID],
    );

    // ── OC en estado EMITIDA (prerequisito para recepcion_oc) ────────────────
    await adminPool.query(
      `INSERT INTO orden_compra (id, tenant_id, empresa_id, numero, tercero_id, estado, moneda, total_monto, created_by, updated_by)
       VALUES ($1,$2,$3,'OC-FC-001',$4,'EMITIDA','DOP',$5,$6,$6)`,
      [ocId, tenantId, empresaId, terceroId, TOTAL_OC, SYSTEM_USER_ID],
    );

    await adminPool.query(
      `INSERT INTO linea_orden_compra (id, tenant_id, orden_compra_id, partida_id, insumo_id, descripcion, cantidad, unidad_medida, precio_unitario, total, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'Hormigon FC',$6,'M3',$7,$8,'DOP',$9,$9)`,
      [lineaOcId, tenantId, ocId, partidaId, insumoId, CANTIDAD_OC, PRECIO_OC, TOTAL_OC, SYSTEM_USER_ID],
    );

    // ── Cuentas contables para regla consumo_material ─────────────────────────
    // 5101 Costo de materiales directos (DEBE en consumo)
    await adminDb.insert(schema.cuentasContables).values({
      id: cuentaGastoId,
      tenantId,
      empresaId,
      codigo: '5101',
      nombre: 'Costo materiales directos',
      tipo: 'gasto',
      naturaleza: 'deudora',
      esMovimiento: true,
      nivel: 1,
      activo: true,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // 1104 Inventario de materiales (HABER en consumo — sale del activo)
    await adminDb.insert(schema.cuentasContables).values({
      id: cuentaInventarioId,
      tenantId,
      empresaId,
      codigo: '1104',
      nombre: 'Inventario materiales',
      tipo: 'activo',
      naturaleza: 'deudora',
      esMovimiento: true,
      nivel: 1,
      activo: true,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // ── Regla contable para consumo_material ──────────────────────────────────
    const configRegla: ConfiguracionRegla = {
      lineas: [
        { cuentaCodigo: '5101', tipo: 'debito',  descripcion: 'Costo material consumido' },
        { cuentaCodigo: '1104', tipo: 'credito', descripcion: 'Salida de inventario' },
      ],
    };

    await adminDb.insert(schema.reglasContables).values({
      id: reglaConsumoId,
      tenantId,
      empresaId,
      tipoEvento: 'consumo_material',
      nombre: 'Consumo material directo',
      descripcion: 'DB 5101 / CR 1104',
      configuracion: configRegla,
      prioridad: 10,
      activo: true,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
  });

  afterAll(async () => {
    // Limpiar en orden FK inverso
    await adminPool.query(`DELETE FROM linea_asiento WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE asiento_contable DISABLE TRIGGER no_delete_asiento_contable`).catch(() => {});
    await adminPool.query(`DELETE FROM asiento_contable WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE asiento_contable ENABLE TRIGGER no_delete_asiento_contable`).catch(() => {});
    await adminPool.query(`DELETE FROM regla_contable WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM cuenta_contable WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM ejecucion_partida WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM movimiento_inventario WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM stock_almacen WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM outbox WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM linea_orden_compra WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE orden_compra DISABLE TRIGGER no_delete_orden_compra`);
    await adminPool.query(`DELETE FROM orden_compra WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE orden_compra ENABLE TRIGGER no_delete_orden_compra`);
    await adminPool.query(`DELETE FROM almacen WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM insumo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM unidad_medida WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`UPDATE version_presupuesto SET estado = 'RECHAZADO' WHERE tenant_id = $1 AND estado = 'APROBADO'`, [tenantId]);
    await adminPool.query(`DELETE FROM linea_presupuesto WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE version_presupuesto DISABLE TRIGGER no_delete_version_presupuesto`);
    await adminPool.query(`DELETE FROM version_presupuesto WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE version_presupuesto ENABLE TRIGGER no_delete_version_presupuesto`);
    await adminPool.query(`ALTER TABLE partida DISABLE TRIGGER no_delete_partida`);
    await adminPool.query(`DELETE FROM partida WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE partida ENABLE TRIGGER no_delete_partida`);
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM scoring_proveedor WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE centro_costo DISABLE TRIGGER no_delete_centro_costo`);
    await adminPool.query(`DELETE FROM centro_costo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE centro_costo ENABLE TRIGGER no_delete_centro_costo`);
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE id = $1`, [empresaId]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
  });

  // ─── Helper: crear evento_operativo y ejecutar handler en transacción ─────

  async function fireEvento(opts: {
    tipo: string;
    payload: Record<string, unknown>;
    handler: { ejecutar: (ctx: { evento: typeof schema.eventosOperativos.$inferSelect; tx: typeof adminDb }) => Promise<void> };
    proyectoId?: string | null;
    referenciaTabla?: string | null;
    referenciaId?: string | null;
  }): Promise<string> {
    const eventoId = newId();

    await adminPool.query(
      `ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`,
    );

    await adminDb.transaction(async (tx) => {
      await tx.insert(schema.eventosOperativos).values({
        id: eventoId,
        tenantId,
        empresaId,
        proyectoId: opts.proyectoId ?? null,
        usuarioId: SYSTEM_USER_ID,
        tipoEvento: opts.tipo,
        payload: opts.payload,
        ocurridoEn: new Date(),
        idempotencyKey: `fc-e2e-${eventoId}`,
        referenciaTabla: opts.referenciaTabla ?? null,
        referenciaId:    opts.referenciaId ?? null,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      });

      const [evento] = await tx
        .select()
        .from(schema.eventosOperativos)
        .where(eq(schema.eventosOperativos.id, eventoId))
        .limit(1);

      await opts.handler.ejecutar({ evento: evento!, tx } as never);
    });

    await adminPool.query(
      `ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`,
    );

    return eventoId;
  }

  // ─── Paso 1: emision_oc → comprometido ───────────────────────────────────

  it('01. emision_oc → comprometido = 28,800 en ejecucion_partida', async () => {
    await fireEvento({
      tipo: 'emision_oc',
      payload: {
        ocId,
        totalMonto: TOTAL_OC,
        moneda: 'DOP',
        lineas: [
          {
            lineaOcId,
            partidaId,
            insumoId,
            descripcion: 'Hormigón FC',
            cantidad:       CANTIDAD_OC,
            precioUnitario: PRECIO_OC,
            total:          TOTAL_OC,
          },
        ],
      },
      handler: emisionOcHandler,
      proyectoId,
    });

    const [ep] = await adminDb
      .select()
      .from(schema.ejecucionPartidas)
      .where(
        and(
          eq(schema.ejecucionPartidas.tenantId, tenantId),
          eq(schema.ejecucionPartidas.partidaId, partidaId),
        ),
      )
      .limit(1);

    expect(ep).toBeDefined();
    expect(new Decimal(ep!.comprometido).toFixed(4)).toBe(TOTAL_OC);
    expect(new Decimal(ep!.devengado).toFixed(4)).toBe('0.0000');
  });

  // ─── Paso 2: recepcion_oc → devengado + stock WAC + movimiento ENTRADA ──

  it('02. recepcion_oc → comprometido→devengado + stock WAC = 480 + movimiento ENTRADA', async () => {
    await fireEvento({
      tipo: 'recepcion_oc',
      payload: {
        ocId,
        recepcionOcId,
        almacenId,
        archivoConduceId: null,
        totalMonto: TOTAL_OC,
        moneda: 'DOP',
        lineas: [
          {
            lineaOcId,
            insumoId,
            partidaId,
            cantidadRecibida: CANTIDAD_OC,
            costoUnitario:    PRECIO_OC,
            moneda:           'DOP',
          },
        ],
      },
      handler: recepcionOcHandler,
      proyectoId,
    });

    // ejecucion_partida: comprometido = 0, devengado = 28,800
    const [ep] = await adminDb
      .select()
      .from(schema.ejecucionPartidas)
      .where(
        and(
          eq(schema.ejecucionPartidas.tenantId, tenantId),
          eq(schema.ejecucionPartidas.partidaId, partidaId),
        ),
      )
      .limit(1);

    expect(new Decimal(ep!.comprometido).toFixed(4)).toBe('0.0000');
    expect(new Decimal(ep!.devengado).toFixed(4)).toBe(EXP_DEVENGADO);

    // stock_almacen: 60 m³ @ 480 WAC
    const [stock] = await adminDb
      .select()
      .from(schema.stockAlmacen)
      .where(
        and(
          eq(schema.stockAlmacen.almacenId, almacenId),
          eq(schema.stockAlmacen.insumoId, insumoId),
        ),
      )
      .limit(1);

    expect(stock).toBeDefined();
    expect(new Decimal(stock!.cantidad).toFixed(4)).toBe(CANTIDAD_OC);
    expect(new Decimal(stock!.costoPorUnitario).toFixed(4)).toBe(PRECIO_OC);

    // movimiento_inventario: 1 ENTRADA de 60 m³
    const movs = await adminDb
      .select()
      .from(schema.movimientosInventario)
      .where(
        and(
          eq(schema.movimientosInventario.tenantId, tenantId),
          eq(schema.movimientosInventario.almacenId, almacenId),
          eq(schema.movimientosInventario.tipoMovimiento, 'ENTRADA'),
        ),
      );

    expect(movs).toHaveLength(1);
    expect(new Decimal(movs[0]!.cantidad).toFixed(4)).toBe(CANTIDAD_OC);
    expect(new Decimal(movs[0]!.costoTotal).toFixed(4)).toBe(TOTAL_OC);
  });

  // ─── Paso 3: consumo_material → stock↓ + asiento contable exacto ─────────

  let eventoConsumoId: string;

  it('03. consumo_material → stock↓ a 20 m³ + asiento DB 5101 / CR 1104 = 19,200', async () => {
    eventoConsumoId = await fireEvento({
      tipo: 'consumo_material',
      payload: {
        insumoId,
        almacenId,
        cantidad:      CANTIDAD_CONSUMO,
        unidad:        'M3',
        costoUnitario: { amount: PRECIO_OC, currency: 'DOP' },
        partidaId,
      },
      handler: {
        ejecutar: async (ctx) => {
          // Ejecutar ambos handlers en secuencia dentro de la misma tx
          await consumoHandler.ejecutar(ctx);
          await contabConsumoHandler.ejecutar(ctx);
        },
      },
      proyectoId,
    });

    // stock debe ser 60 − 40 = 20 m³
    const [stock] = await adminDb
      .select()
      .from(schema.stockAlmacen)
      .where(
        and(
          eq(schema.stockAlmacen.almacenId, almacenId),
          eq(schema.stockAlmacen.insumoId, insumoId),
        ),
      )
      .limit(1);

    expect(new Decimal(stock!.cantidad).toFixed(4)).toBe('20.0000');

    // movimiento SALIDA generado
    const salidas = await adminDb
      .select()
      .from(schema.movimientosInventario)
      .where(
        and(
          eq(schema.movimientosInventario.tenantId, tenantId),
          eq(schema.movimientosInventario.tipoMovimiento, 'SALIDA'),
        ),
      );

    expect(salidas).toHaveLength(1);
    expect(new Decimal(salidas[0]!.costoTotal).toFixed(4)).toBe(COSTO_CONSUMO);

    // asiento contable generado
    const [asiento] = await adminDb
      .select()
      .from(schema.asientosContables)
      .where(
        and(
          eq(schema.asientosContables.tenantId, tenantId),
          eq(schema.asientosContables.eventoId, eventoConsumoId),
        ),
      );

    expect(asiento).toBeDefined();

    const lineas = await adminDb
      .select()
      .from(schema.lineasAsiento)
      .where(eq(schema.lineasAsiento.asientoId, asiento!.id));

    expect(lineas).toHaveLength(2);

    const debe  = lineas.find((l) => l.tipo === 'debe');
    const haber = lineas.find((l) => l.tipo === 'haber');

    expect(debe).toBeDefined();
    expect(haber).toBeDefined();

    // Importes exactos
    expect(new Decimal(debe!.importe).toFixed(4)).toBe(COSTO_CONSUMO);
    expect(new Decimal(haber!.importe).toFixed(4)).toBe(COSTO_CONSUMO);

    // Σdebe = Σhaber (asiento cuadrado)
    const sumaDebe  = lineas.filter((l) => l.tipo === 'debe').reduce((acc, l) => acc.plus(l.importe), new Decimal(0));
    const sumaHaber = lineas.filter((l) => l.tipo === 'haber').reduce((acc, l) => acc.plus(l.importe), new Decimal(0));
    expect(sumaDebe.toFixed(4)).toBe(sumaHaber.toFixed(4));
  });

  // ─── Paso 4: avance_partida → avanceCantidad ──────────────────────────────

  it('04. avance_partida → avanceCantidad = 30 m³ en ejecucion_partida', async () => {
    const parteDiarioId = newId();
    const avanceObraId  = newId();

    await fireEvento({
      tipo: 'avance_partida',
      payload: {
        parteDiarioId,
        avanceObraId,
        proyectoId,
        partidaId,
        cantidadEjecutada: CANTIDAD_AVANCE,
        unidad: 'M3',
        cantidadPresupuestada: CANTIDAD_PRES,
      },
      handler: avanceHandler,
      proyectoId,
    });

    const [ep] = await adminDb
      .select()
      .from(schema.ejecucionPartidas)
      .where(
        and(
          eq(schema.ejecucionPartidas.tenantId, tenantId),
          eq(schema.ejecucionPartidas.partidaId, partidaId),
        ),
      )
      .limit(1);

    expect(new Decimal(ep!.avanceCantidad ?? '0').toFixed(4)).toBe(CANTIDAD_AVANCE);
  });

  // ─── Paso 5: Tríada — comprometido + devengado + disponible = presupuestoVigente ─

  it('05. Tríada reconcilia: comprometido + devengado + disponible = presupuestoVigente (50,000)', async () => {
    // presupuestoVigente = linea_presupuesto.total (BASE APROBADO) + presupuestoAdicionalOc
    const [ep] = await adminDb
      .select()
      .from(schema.ejecucionPartidas)
      .where(
        and(
          eq(schema.ejecucionPartidas.tenantId, tenantId),
          eq(schema.ejecucionPartidas.partidaId, partidaId),
        ),
      )
      .limit(1);

    const [lineaBase] = await adminDb
      .select({ total: schema.lineasPresupuesto.total })
      .from(schema.lineasPresupuesto)
      .where(eq(schema.lineasPresupuesto.id, lineaPresupId));

    const presupuestoVigente = new Decimal(lineaBase!.total)
      .plus(ep!.presupuestoAdicionalOc ?? '0');

    const comprometido = new Decimal(ep!.comprometido);
    const devengado    = new Decimal(ep!.devengado);
    const disponible   = presupuestoVigente.minus(comprometido).minus(devengado);

    // Verificar cada componente
    expect(comprometido.toFixed(4)).toBe(EXP_COMPROMETIDO);
    expect(devengado.toFixed(4)).toBe(EXP_DEVENGADO);
    expect(disponible.toFixed(4)).toBe(EXP_DISPONIBLE);

    // La tríada cuadra
    const triada = comprometido.plus(devengado).plus(disponible);
    expect(triada.toFixed(4)).toBe(presupuestoVigente.toFixed(4));
    expect(presupuestoVigente.toFixed(4)).toBe(TOTAL_PRES);
  });

  // ─── Paso 6: EVM — EV y CPI con valores exactos ───────────────────────────

  it('06. EVM: EV = 15,000; AC = 28,800; CPI ≈ 0.5208', async () => {
    const [ep] = await adminDb
      .select()
      .from(schema.ejecucionPartidas)
      .where(
        and(
          eq(schema.ejecucionPartidas.tenantId, tenantId),
          eq(schema.ejecucionPartidas.partidaId, partidaId),
        ),
      )
      .limit(1);

    const [lineaBase] = await adminDb
      .select({ total: schema.lineasPresupuesto.total, cantidad: schema.lineasPresupuesto.cantidad })
      .from(schema.lineasPresupuesto)
      .where(eq(schema.lineasPresupuesto.id, lineaPresupId));

    const presupuestoVigente = new Decimal(lineaBase!.total)
      .plus(ep!.presupuestoAdicionalOc ?? '0');

    const cantidadVigente = new Decimal(lineaBase!.cantidad)
      .plus(ep!.cantidadAdicionalOc ?? '0');

    const avanceCantidad = new Decimal(ep!.avanceCantidad ?? '0');
    const devengado      = new Decimal(ep!.devengado);

    // EV = presupuestoVigente × (avanceCantidad / cantidadVigente)
    const ev = presupuestoVigente.mul(avanceCantidad.div(cantidadVigente));
    // AC = devengado (costo real incurrido vía OC)
    const ac = devengado;
    // CPI = EV / AC
    const cpi = ac.gt(0) ? ev.div(ac) : null;

    expect(ev.toFixed(4)).toBe(EXP_EV.toFixed(4));          // 15,000.0000
    expect(ac.toFixed(4)).toBe(EXP_DEVENGADO);               // 28,800.0000
    expect(cpi?.toFixed(4)).toBe(EXP_CPI.toFixed(4));        // 0.5208 (aprox)
  });

  // ─── Paso 7: Integridad del asiento — ningún asiento descuadrado ──────────

  it('07. Todos los asientos del tenant tienen Σdebe = Σhaber (integridad contable)', async () => {
    const resultado = await adminPool.query<{ asiento_id: string; suma_debe: string; suma_haber: string }>(
      `SELECT
         la.asiento_id,
         SUM(CASE WHEN la.tipo = 'debe'  THEN la.importe::numeric ELSE 0 END) AS suma_debe,
         SUM(CASE WHEN la.tipo = 'haber' THEN la.importe::numeric ELSE 0 END) AS suma_haber
       FROM linea_asiento la
       JOIN asiento_contable ac ON ac.id = la.asiento_id
       WHERE ac.tenant_id = $1
       GROUP BY la.asiento_id
       HAVING ABS(
         SUM(CASE WHEN la.tipo = 'debe'  THEN la.importe::numeric ELSE 0 END) -
         SUM(CASE WHEN la.tipo = 'haber' THEN la.importe::numeric ELSE 0 END)
       ) > 0.0001`,
      [tenantId],
    );

    expect(resultado.rows).toHaveLength(0);
  });

  // ─── Paso 8: RLS — partida del tenant solo visible para ese tenant ─────────

  it('08. RLS: query sin SET LOCAL retorna 0 filas de ejecucion_partida', async () => {
    const appPool = new Pool({
      connectionString:
        process.env['DATABASE_URL_APP'] ??
        'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore',
    });
    const appDb = drizzle(appPool, { schema });

    try {
      // Sin SET LOCAL app.tenant_id → RLS bloquea todo
      const filas = await appDb
        .select()
        .from(schema.ejecucionPartidas)
        .where(eq(schema.ejecucionPartidas.tenantId, tenantId));

      expect(filas).toHaveLength(0);
    } finally {
      await appPool.end();
    }
  });
});
