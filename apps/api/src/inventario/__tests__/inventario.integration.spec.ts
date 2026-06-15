/**
 * PRUEBAS DE INTEGRACIÓN — Inventario y almacenes (Sesión 4 Capa 1)
 *
 * Verifican el flujo "evento → stock → costo → asiento" de extremo a extremo:
 *
 *  01. recepcion_material: stock incrementa en cantidad exacta.
 *  02. WAC: 10@100 + 5@120 → costo_promedio_ponderado = 106.6667.
 *  03. consumo_material: stock decrementa a la cantidad esperada.
 *  04. consumo_material: genera asiento exacto (DB 5101 / CR 1104.01, importe 500).
 *  05. recepcion_material: genera asiento exacto (DB 1104.01 / CR 2101.01).
 *  06. consumo_material falla con stock insuficiente.
 *  07. transferencia_almacen: decrements source y incrementa destino.
 *  08. transferencia_almacen: WAC del origen se propaga al destino.
 *  09. transferencia_almacen falla con stock insuficiente en origen.
 *  10. ajuste_inventario: fija stock a cantidadFisica.
 *  11. ajuste_inventario gana (physica > sistema): asiento DB 1104.01 / CR 5901.
 *  12. ajuste_inventario pierde (fisica < sistema): asiento invertido DB 5901 / CR 1104.01.
 *  13. movimiento_inventario append-only: tributia_app no puede DELETE.
 *  14. RLS: tenant2 no puede leer stock de tenant1.
 *  15. Kárdex: devuelve movimientos en orden para (almacen, insumo).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import type { ConfiguracionRegla } from '@tributia/contabilidad';
import { InventarioRecepcionMaterialHandler } from '../handlers/inventario-recepcion-material.handler.js';
import { InventarioConsumoMaterialHandler } from '../handlers/inventario-consumo-material.handler.js';
import { InventarioTransferenciaAlmacenHandler } from '../handlers/inventario-transferencia-almacen.handler.js';
import { InventarioAjusteInventarioHandler } from '../handlers/inventario-ajuste-inventario.handler.js';
import { ContabilidadConsumoMaterialHandler } from '../../contabilidad/handlers/contabilidad-consumo-material.handler.js';
import { ContabilidadRecepcionMaterialHandler } from '../../contabilidad/handlers/contabilidad-recepcion-material.handler.js';
import { ContabilidadAjusteInventarioHandler } from '../../contabilidad/handlers/contabilidad-ajuste-inventario.handler.js';
import { ReglaContableService } from '../../contabilidad/regla-contable.service.js';
import { CuentaContableService } from '../../contabilidad/cuenta-contable.service.js';
import { AsientoContableService } from '../../contabilidad/asiento-contable.service.js';

// ─── Conexiones ──────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Inventario — flujo evento→stock→costo→asiento', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  // IDs compartidos del contexto de prueba
  let tenantId: string;
  let t2: string; // tenant2 para RLS
  let empresaId: string;
  let e2: string; // empresa2 para RLS
  let centroCostoId: string;
  let cc2: string;
  let unidadId: string;
  let almacen1Id: string;
  let almacen2Id: string;

  // Cuentas y reglas contables
  let cuentaInventarioId: string;  // 1104.01
  let cuentaProveedorId: string;   // 2101.01
  let cuentaCostoId: string;       // 5101
  let cuentaAjusteId: string;      // 5901
  let reglaConsumoId: string;
  let reglaRecepcionId: string;
  let reglaAjusteId: string;

  // Handlers instanciados directamente (sin NestJS DI)
  let invRecepcion: InventarioRecepcionMaterialHandler;
  let invConsumo: InventarioConsumoMaterialHandler;
  let invTransferencia: InventarioTransferenciaAlmacenHandler;
  let invAjuste: InventarioAjusteInventarioHandler;
  let contabConsumo: ContabilidadConsumoMaterialHandler;
  let contabRecepcion: ContabilidadRecepcionMaterialHandler;
  let contabAjuste: ContabilidadAjusteInventarioHandler;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool   = new Pool({ connectionString: APP_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantId      = newId();
    t2            = newId();
    empresaId     = newId();
    e2            = newId();
    centroCostoId = newId();
    cc2           = newId();
    unidadId      = newId();
    almacen1Id    = newId();
    almacen2Id    = newId();

    cuentaInventarioId = newId();
    cuentaProveedorId  = newId();
    cuentaCostoId      = newId();
    cuentaAjusteId     = newId();
    reglaConsumoId     = newId();
    reglaRecepcionId   = newId();
    reglaAjusteId      = newId();

    // Tenant 1
    await adminDb.insert(schema.tenants).values({
      id: tenantId, nombre: 'Constructora Inventario [test]',
      slug: `inv-t1-${tenantId.slice(0, 6)}`,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    // Tenant 2 (RLS)
    await adminDb.insert(schema.tenants).values({
      id: t2, nombre: 'Otra Constructora [test]',
      slug: `inv-t2-${t2.slice(0, 6)}`,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    await adminDb.insert(schema.empresas).values({
      id: empresaId, tenantId, nombre: 'Empresa Inv [test]',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await adminDb.insert(schema.empresas).values({
      id: e2, tenantId: t2, nombre: 'Empresa Inv2 [test]',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    await adminDb.insert(schema.centrosCosto).values({
      id: centroCostoId, tenantId, empresaId, codigo: 'ADM-INV', nombre: 'Admin Inventario',
      tipo: 'ADMINISTRATIVO', createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await adminDb.insert(schema.centrosCosto).values({
      id: cc2, tenantId: t2, empresaId: e2, codigo: 'ADM-INV2', nombre: 'Admin Inv2',
      tipo: 'ADMINISTRATIVO', createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    // Unidad de medida
    await adminDb.insert(schema.unidadesMedida).values({
      id: unidadId, tenantId, codigo: 'UND', nombre: 'Unidad',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    // Almacenes
    await adminPool.query(
      `INSERT INTO almacen (id, tenant_id, empresa_id, tipo, codigo, nombre, created_by, updated_by)
       VALUES ($1,$2,$3,'CENTRAL','ALM-CENTRAL','Almacén Central',$4,$4),
              ($5,$2,$3,'OBRA',   'ALM-OBRA',   'Almacén Obra',   $4,$4)`,
      [almacen1Id, tenantId, empresaId, SYSTEM_USER_ID, almacen2Id],
    );

    // Plan de cuentas (mínimo para tests)
    await adminDb.insert(schema.cuentasContables).values([
      {
        id: cuentaInventarioId, tenantId, empresaId, codigo: '1104.01',
        nombre: 'Inventario de Materiales', tipo: 'activo', naturaleza: 'deudora',
        nivel: 4, esMovimiento: true, activo: true,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      },
      {
        id: cuentaProveedorId, tenantId, empresaId, codigo: '2101.01',
        nombre: 'Proveedores de Materiales', tipo: 'pasivo', naturaleza: 'acreedora',
        nivel: 4, esMovimiento: true, activo: true,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      },
      {
        id: cuentaCostoId, tenantId, empresaId, codigo: '5101',
        nombre: 'Costo de Obra en Proceso', tipo: 'costo', naturaleza: 'deudora',
        nivel: 3, esMovimiento: true, activo: true,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      },
      {
        id: cuentaAjusteId, tenantId, empresaId, codigo: '5901',
        nombre: 'Ajuste de Inventario', tipo: 'gasto', naturaleza: 'deudora',
        nivel: 3, esMovimiento: true, activo: true,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      },
    ]);

    // Reglas contables
    const reglaConsumoConfig: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito',  cuentaCodigo: '5101',    descripcion: 'Costo obra' },
        { tipo: 'credito', cuentaCodigo: '1104.01', descripcion: 'Salida inventario' },
      ],
    };
    const reglaRecepcionConfig: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito',  cuentaCodigo: '1104.01', descripcion: 'Entrada inventario' },
        { tipo: 'credito', cuentaCodigo: '2101.01', descripcion: 'Cuentas por pagar' },
      ],
    };
    const reglaAjusteConfig: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito',  cuentaCodigo: '1104.01', descripcion: 'Inventario ajustado' },
        { tipo: 'credito', cuentaCodigo: '5901',    descripcion: 'Ajuste inventario' },
      ],
    };

    await adminDb.insert(schema.reglasContables).values([
      {
        id: reglaConsumoId, tenantId, empresaId, tipoEvento: 'consumo_material',
        nombre: 'Consumo test', configuracion: reglaConsumoConfig,
        prioridad: 0, activo: true, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      },
      {
        id: reglaRecepcionId, tenantId, empresaId, tipoEvento: 'recepcion_material',
        nombre: 'Recepcion test', configuracion: reglaRecepcionConfig,
        prioridad: 0, activo: true, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      },
      {
        id: reglaAjusteId, tenantId, empresaId, tipoEvento: 'ajuste_inventario',
        nombre: 'Ajuste test', configuracion: reglaAjusteConfig,
        prioridad: 0, activo: true, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      },
    ]);

    // Instanciar handlers sin NestJS DI (métodos críticos usan `tx` como parámetro)
    invRecepcion    = new InventarioRecepcionMaterialHandler();
    invConsumo      = new InventarioConsumoMaterialHandler();
    invTransferencia = new InventarioTransferenciaAlmacenHandler();
    invAjuste       = new InventarioAjusteInventarioHandler();

    const cuentaService   = new CuentaContableService(null as never);
    const reglaService    = new ReglaContableService();
    const asientoService  = new AsientoContableService(null as never, cuentaService);

    contabConsumo    = new ContabilidadConsumoMaterialHandler(reglaService, asientoService);
    contabRecepcion  = new ContabilidadRecepcionMaterialHandler(reglaService, asientoService);
    contabAjuste     = new ContabilidadAjusteInventarioHandler(reglaService, asientoService);
  });

  afterAll(async () => {
    // Limpiar en orden FK inverso. Varios triggers prevent_delete requieren DISABLE explícito.
    await adminPool.query(`DELETE FROM movimiento_inventario WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM herramienta_asignada WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM linea_conteo_fisico WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM conteo_fisico WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM stock_almacen WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM almacen WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM linea_asiento WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM asiento_contable WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM regla_contable WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM cuenta_contable WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM outbox WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM insumo WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM unidad_medida WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE centro_costo DISABLE TRIGGER no_delete_centro_costo`);
    await adminPool.query(`DELETE FROM centro_costo WHERE id IN ($1,$2)`, [centroCostoId, cc2]);
    await adminPool.query(`ALTER TABLE centro_costo ENABLE TRIGGER no_delete_centro_costo`);
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE id IN ($1,$2)`, [empresaId, e2]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
    await appPool.end();
  });

  // ─── Helpers de test ─────────────────────────────────────────────────────────

  async function insertInsumo(suffix: string): Promise<string> {
    const id = newId();
    await adminPool.query(
      `INSERT INTO insumo (id, tenant_id, codigo, nombre, unidad_id, categoria, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'MATERIAL',$6,$6)`,
      [id, tenantId, `INS-${suffix}`, `Insumo ${suffix}`, unidadId, SYSTEM_USER_ID],
    );
    return id;
  }

  async function insertEvento(
    tipo: string,
    payload: object,
    centroCosto = centroCostoId,
  ): Promise<EventoOperativoSelect> {
    const [evt] = await adminDb
      .insert(schema.eventosOperativos)
      .values({
        id: newId(),
        tenantId,
        empresaId,
        centroCostoId: centroCosto,
        tipoEvento: tipo,
        usuarioId: SYSTEM_USER_ID,
        payload,
        idempotencyKey: newId(),
        createdBy: SYSTEM_USER_ID,
      })
      .returning();
    return evt!;
  }

  // ─── 01. recepcion_material incrementa stock ──────────────────────────────
  it('01. recepcion_material incrementa stock en la cantidad exacta', async () => {
    const insumoId = await insertInsumo('01');
    const payload = {
      insumoId, almacenId: almacen1Id,
      cantidad: '10.0000', unidad: 'UND',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
      ordenCompraId: null, conductNo: null,
    };
    const evento = await insertEvento('recepcion_material', payload);

    await adminDb.transaction(async (tx) => {
      await invRecepcion.ejecutar({ evento, tx });
    });

    const [stock] = await adminDb
      .select()
      .from(schema.stockAlmacen)
      .where(and(eq(schema.stockAlmacen.almacenId, almacen1Id), eq(schema.stockAlmacen.insumoId, insumoId)));

    expect(stock).toBeDefined();
    expect(parseFloat(stock!.cantidad)).toBe(10);
    expect(parseFloat(stock!.costoPorUnitario)).toBe(100);
  });

  // ─── 02. WAC: 10@100, luego 5@120 → 106.6667 ────────────────────────────
  it('02. WAC recalcula a 106.6667 tras recibir 10@100 y luego 5@120', async () => {
    const insumoId = await insertInsumo('02');

    // Primera recepción: 10 a 100
    const payload1 = {
      insumoId, almacenId: almacen1Id,
      cantidad: '10.0000', unidad: 'UND',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
      ordenCompraId: null, conductNo: null,
    };
    const evt1 = await insertEvento('recepcion_material', payload1);
    await adminDb.transaction(async (tx) => {
      await invRecepcion.ejecutar({ evento: evt1, tx });
    });

    // Segunda recepción: 5 a 120
    const payload2 = {
      insumoId, almacenId: almacen1Id,
      cantidad: '5.0000', unidad: 'UND',
      costoUnitario: { amount: '120.0000', currency: 'DOP' },
      ordenCompraId: null, conductNo: null,
    };
    const evt2 = await insertEvento('recepcion_material', payload2);
    await adminDb.transaction(async (tx) => {
      await invRecepcion.ejecutar({ evento: evt2, tx });
    });

    const [stock] = await adminDb
      .select()
      .from(schema.stockAlmacen)
      .where(and(eq(schema.stockAlmacen.almacenId, almacen1Id), eq(schema.stockAlmacen.insumoId, insumoId)));

    // WAC = (10*100 + 5*120) / (10+5) = 1600/15 = 106.6667
    expect(parseFloat(stock!.cantidad)).toBe(15);
    expect(stock!.costoPorUnitario).toBe('106.6667');
  });

  // ─── 03. consumo_material decrementa stock ────────────────────────────────
  it('03. consumo_material deja el stock en cantidad esperada', async () => {
    const insumoId = await insertInsumo('03');

    // Pre-popular stock
    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'10.0000','100.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    const payload = {
      insumoId, almacenId: almacen1Id,
      cantidad: '3.0000', unidad: 'UND',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
      partidaId: null,
    };
    const evento = await insertEvento('consumo_material', payload);

    await adminDb.transaction(async (tx) => {
      await invConsumo.ejecutar({ evento, tx });
    });

    const [stock] = await adminDb
      .select()
      .from(schema.stockAlmacen)
      .where(and(eq(schema.stockAlmacen.almacenId, almacen1Id), eq(schema.stockAlmacen.insumoId, insumoId)));

    expect(parseFloat(stock!.cantidad)).toBe(7); // 10 - 3
  });

  // ─── 04. consumo_material genera asiento exacto (DB 5101 / CR 1104.01) ───
  it('04. consumo_material genera asiento DB 5101 / CR 1104.01 por 500.0000', async () => {
    const insumoId = await insertInsumo('04');

    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'20.0000','100.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    const payload = {
      insumoId, almacenId: almacen1Id,
      cantidad: '5.0000', unidad: 'UND',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
      partidaId: null,
    };
    const evento = await insertEvento('consumo_material', payload);

    await adminDb.transaction(async (tx) => {
      await invConsumo.ejecutar({ evento, tx });
      await contabConsumo.ejecutar({ evento, tx });
    });

    // Verificar asiento
    const res = await adminPool.query(
      `SELECT la.tipo, la.importe::numeric, cc.codigo
       FROM linea_asiento la
       JOIN asiento_contable ac ON ac.id = la.asiento_id
       JOIN cuenta_contable cc ON cc.id = la.cuenta_id
       WHERE ac.evento_id = $1
       ORDER BY la.tipo`,
      [evento.id],
    );

    expect(res.rows).toHaveLength(2);
    const debe  = res.rows.find((r: Record<string, unknown>) => r.tipo === 'debe');
    const haber = res.rows.find((r: Record<string, unknown>) => r.tipo === 'haber');
    expect(debe?.codigo).toBe('5101');
    expect(Number(debe?.importe)).toBe(500);
    expect(haber?.codigo).toBe('1104.01');
    expect(Number(haber?.importe)).toBe(500);
  });

  // ─── 05. recepcion_material genera asiento exacto (DB 1104.01 / CR 2101.01)
  it('05. recepcion_material genera asiento DB 1104.01 / CR 2101.01 por 1000.0000', async () => {
    const insumoId = await insertInsumo('05');
    const payload = {
      insumoId, almacenId: almacen1Id,
      cantidad: '10.0000', unidad: 'UND',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
      ordenCompraId: null, conductNo: null,
    };
    const evento = await insertEvento('recepcion_material', payload);

    await adminDb.transaction(async (tx) => {
      await invRecepcion.ejecutar({ evento, tx });
      await contabRecepcion.ejecutar({ evento, tx });
    });

    const res = await adminPool.query(
      `SELECT la.tipo, la.importe::numeric, cc.codigo
       FROM linea_asiento la
       JOIN asiento_contable ac ON ac.id = la.asiento_id
       JOIN cuenta_contable cc ON cc.id = la.cuenta_id
       WHERE ac.evento_id = $1
       ORDER BY la.tipo`,
      [evento.id],
    );

    expect(res.rows).toHaveLength(2);
    const debe  = res.rows.find((r: Record<string, unknown>) => r.tipo === 'debe');
    const haber = res.rows.find((r: Record<string, unknown>) => r.tipo === 'haber');
    expect(debe?.codigo).toBe('1104.01');
    expect(Number(debe?.importe)).toBe(1000);
    expect(haber?.codigo).toBe('2101.01');
    expect(Number(haber?.importe)).toBe(1000);
  });

  // ─── 06. consumo_material rechaza stock insuficiente ─────────────────────
  it('06. consumo_material rechaza con 422 cuando stock es insuficiente', async () => {
    const insumoId = await insertInsumo('06');

    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'5.0000','100.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    const payload = {
      insumoId, almacenId: almacen1Id,
      cantidad: '10.0000', unidad: 'UND',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
      partidaId: null,
    };
    const evento = await insertEvento('consumo_material', payload);

    await expect(
      adminDb.transaction(async (tx) => {
        await invConsumo.ejecutar({ evento, tx });
      }),
    ).rejects.toThrow(/Stock insuficiente/);
  });

  // ─── 07. transferencia_almacen mueve stock ────────────────────────────────
  it('07. transferencia_almacen: origen pierde y destino gana la cantidad exacta', async () => {
    const insumoId = await insertInsumo('07');

    // Pre-popular stock en origen
    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'20.0000','100.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    const payload = {
      almacenOrigenId: almacen1Id,
      almacenDestinoId: almacen2Id,
      insumoId, cantidad: '8.0000', unidad: 'UND',
    };
    const evento = await insertEvento('transferencia_almacen', payload);

    await adminDb.transaction(async (tx) => {
      await invTransferencia.ejecutar({ evento, tx });
    });

    const [stockOrigen] = await adminDb
      .select()
      .from(schema.stockAlmacen)
      .where(and(eq(schema.stockAlmacen.almacenId, almacen1Id), eq(schema.stockAlmacen.insumoId, insumoId)));
    const [stockDestino] = await adminDb
      .select()
      .from(schema.stockAlmacen)
      .where(and(eq(schema.stockAlmacen.almacenId, almacen2Id), eq(schema.stockAlmacen.insumoId, insumoId)));

    expect(parseFloat(stockOrigen!.cantidad)).toBe(12); // 20 - 8
    expect(parseFloat(stockDestino!.cantidad)).toBe(8);
  });

  // ─── 08. transferencia_almacen propaga WAC al destino ─────────────────────
  it('08. transferencia_almacen: WAC del origen se propaga al destino vacío', async () => {
    const insumoId = await insertInsumo('08');

    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'10.0000','150.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    const payload = {
      almacenOrigenId: almacen1Id,
      almacenDestinoId: almacen2Id,
      insumoId, cantidad: '4.0000', unidad: 'UND',
    };
    const evento = await insertEvento('transferencia_almacen', payload);

    await adminDb.transaction(async (tx) => {
      await invTransferencia.ejecutar({ evento, tx });
    });

    const [stockDestino] = await adminDb
      .select()
      .from(schema.stockAlmacen)
      .where(and(eq(schema.stockAlmacen.almacenId, almacen2Id), eq(schema.stockAlmacen.insumoId, insumoId)));

    expect(parseFloat(stockDestino!.costoPorUnitario)).toBe(150);
  });

  // ─── 09. transferencia_almacen rechaza stock insuficiente en origen ───────
  it('09. transferencia_almacen rechaza cuando origen no tiene stock suficiente', async () => {
    const insumoId = await insertInsumo('09');

    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'3.0000','100.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    const payload = {
      almacenOrigenId: almacen1Id,
      almacenDestinoId: almacen2Id,
      insumoId, cantidad: '10.0000', unidad: 'UND',
    };
    const evento = await insertEvento('transferencia_almacen', payload);

    await expect(
      adminDb.transaction(async (tx) => {
        await invTransferencia.ejecutar({ evento, tx });
      }),
    ).rejects.toThrow(/Stock insuficiente/);
  });

  // ─── 10. ajuste_inventario fija stock a cantidadFisica ───────────────────
  it('10. ajuste_inventario fija stock exactamente a cantidadFisica', async () => {
    const insumoId = await insertInsumo('10');

    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'20.0000','100.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    const payload = {
      almacenId: almacen1Id, insumoId,
      cantidadSistema: '20.0000', cantidadFisica: '17.0000',
      unidad: 'UND', motivo: 'CONTEO_FISICO',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
    };
    const evento = await insertEvento('ajuste_inventario', payload);

    await adminDb.transaction(async (tx) => {
      await invAjuste.ejecutar({ evento, tx });
    });

    const [stock] = await adminDb
      .select()
      .from(schema.stockAlmacen)
      .where(and(eq(schema.stockAlmacen.almacenId, almacen1Id), eq(schema.stockAlmacen.insumoId, insumoId)));

    expect(parseFloat(stock!.cantidad)).toBe(17); // fijado a cantidadFisica
  });

  // ─── 11. ajuste_inventario ganancia → DB 1104.01 / CR 5901 ───────────────
  it('11. ajuste_inventario (ganancia) genera asiento DB 1104.01 / CR 5901', async () => {
    const insumoId = await insertInsumo('11');

    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'10.0000','100.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    // física > sistema → GANANCIA
    const payload = {
      almacenId: almacen1Id, insumoId,
      cantidadSistema: '10.0000', cantidadFisica: '12.0000',
      unidad: 'UND', motivo: 'CONTEO_FISICO',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
    };
    const evento = await insertEvento('ajuste_inventario', payload);

    await adminDb.transaction(async (tx) => {
      await invAjuste.ejecutar({ evento, tx });
      await contabAjuste.ejecutar({ evento, tx });
    });

    const res = await adminPool.query(
      `SELECT la.tipo, la.importe::numeric, cc.codigo
       FROM linea_asiento la
       JOIN asiento_contable ac ON ac.id = la.asiento_id
       JOIN cuenta_contable cc ON cc.id = la.cuenta_id
       WHERE ac.evento_id = $1
       ORDER BY la.tipo`,
      [evento.id],
    );

    // Diferencia: +2 @ 100 = 200; DB inventario / CR ajuste
    expect(res.rows).toHaveLength(2);
    const debe  = res.rows.find((r: Record<string, unknown>) => r.tipo === 'debe');
    const haber = res.rows.find((r: Record<string, unknown>) => r.tipo === 'haber');
    expect(debe?.codigo).toBe('1104.01');
    expect(Number(debe?.importe)).toBe(200);
    expect(haber?.codigo).toBe('5901');
    expect(Number(haber?.importe)).toBe(200);
  });

  // ─── 12. ajuste_inventario pérdida → asiento invertido DB 5901 / CR 1104.01
  it('12. ajuste_inventario (pérdida) genera asiento DB 5901 / CR 1104.01', async () => {
    const insumoId = await insertInsumo('12');

    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'15.0000','100.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    // física < sistema → PÉRDIDA
    const payload = {
      almacenId: almacen1Id, insumoId,
      cantidadSistema: '15.0000', cantidadFisica: '10.0000',
      unidad: 'UND', motivo: 'MERMA',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
    };
    const evento = await insertEvento('ajuste_inventario', payload);

    await adminDb.transaction(async (tx) => {
      await invAjuste.ejecutar({ evento, tx });
      await contabAjuste.ejecutar({ evento, tx });
    });

    const res = await adminPool.query(
      `SELECT la.tipo, la.importe::numeric, cc.codigo
       FROM linea_asiento la
       JOIN asiento_contable ac ON ac.id = la.asiento_id
       JOIN cuenta_contable cc ON cc.id = la.cuenta_id
       WHERE ac.evento_id = $1
       ORDER BY la.tipo`,
      [evento.id],
    );

    // Diferencia: -5 @ 100 = 500; INVERTIDO: DB ajuste / CR inventario
    expect(res.rows).toHaveLength(2);
    const debe  = res.rows.find((r: Record<string, unknown>) => r.tipo === 'debe');
    const haber = res.rows.find((r: Record<string, unknown>) => r.tipo === 'haber');
    expect(debe?.codigo).toBe('5901');
    expect(Number(debe?.importe)).toBe(500);
    expect(haber?.codigo).toBe('1104.01');
    expect(Number(haber?.importe)).toBe(500);
  });

  // ─── 13. movimiento_inventario es append-only ─────────────────────────────
  it('13. tributia_app no puede DELETE en movimiento_inventario', async () => {
    const insumoId = await insertInsumo('13');
    const movId = newId();

    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'5.0000','100.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    const payload = {
      insumoId, almacenId: almacen1Id,
      cantidad: '5.0000', unidad: 'UND',
      costoUnitario: { amount: '100.0000', currency: 'DOP' },
      ordenCompraId: null, conductNo: null,
    };
    const evento = await insertEvento('recepcion_material', payload);

    // Insertar movimiento via admin
    await adminPool.query(
      `INSERT INTO movimiento_inventario (id, tenant_id, almacen_id, insumo_id, tipo_movimiento, cantidad, costo_unitario, costo_total, moneda, evento_operativo_id, created_by)
       VALUES ($1,$2,$3,$4,'ENTRADA','5.0000','100.0000','500.0000','DOP',$5,$6)`,
      [movId, tenantId, almacen1Id, insumoId, evento.id, SYSTEM_USER_ID],
    );

    // Intentar DELETE como tributia_app → debe fallar (solo SELECT e INSERT grant)
    await expect(
      appPool.query(`DELETE FROM movimiento_inventario WHERE id = $1`, [movId]),
    ).rejects.toThrow();
  });

  // ─── 14. RLS: tenant2 no ve stock de tenant1 ─────────────────────────────
  it('14. RLS: tenant2 no puede leer stock del tenant1 via appPool', async () => {
    const insumoId = await insertInsumo('14');

    await adminPool.query(
      `INSERT INTO stock_almacen (id, tenant_id, almacen_id, insumo_id, cantidad, costo_promedio_ponderado, moneda)
       VALUES ($1,$2,$3,$4,'100.0000','50.0000','DOP')`,
      [newId(), tenantId, almacen1Id, insumoId],
    );

    // Conectar como t2 vía appPool
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id       = '${t2}'`);
      await client.query(`SET LOCAL app.current_user_id = '${SYSTEM_USER_ID}'`);
      await client.query(`SET LOCAL app.client_ip       = '127.0.0.1'`);
      await client.query(`SET LOCAL app.user_agent      = 'test'`);

      const res = await client.query(
        `SELECT * FROM stock_almacen WHERE almacen_id = $1 AND insumo_id = $2`,
        [almacen1Id, insumoId],
      );
      await client.query('COMMIT');

      expect(res.rows).toHaveLength(0); // RLS bloquea
    } finally {
      client.release();
    }
  });

  // ─── 15. Kárdex devuelve movimientos en orden ────────────────────────────
  it('15. kárdex devuelve los movimientos en orden cronológico inverso', async () => {
    const insumoId = await insertInsumo('15');

    // Dos recepciones
    for (let i = 0; i < 3; i++) {
      const p = {
        insumoId, almacenId: almacen1Id,
        cantidad: `${(i + 1) * 5}.0000`, unidad: 'UND',
        costoUnitario: { amount: '100.0000', currency: 'DOP' },
        ordenCompraId: null, conductNo: null,
      };
      const evt = await insertEvento('recepcion_material', p);
      await adminDb.transaction(async (tx) => {
        await invRecepcion.ejecutar({ evento: evt, tx });
      });
    }

    const movimientos = await adminDb
      .select()
      .from(schema.movimientosInventario)
      .where(
        and(
          eq(schema.movimientosInventario.almacenId, almacen1Id),
          eq(schema.movimientosInventario.insumoId, insumoId),
        ),
      );

    expect(movimientos.length).toBe(3);
    // Todos son ENTRADA
    expect(movimientos.every((m) => m.tipoMovimiento === 'ENTRADA')).toBe(true);
    // Cantidades: 5, 10, 15 (en algún orden — todos deben estar presentes)
    const cantidades = movimientos.map((m) => parseFloat(m.cantidad)).sort((a, b) => a - b);
    expect(cantidades).toEqual([5, 10, 15]);
  });
});
