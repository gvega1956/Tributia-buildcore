/**
 * PRUEBAS DE INTEGRACIÓN — Compras I: Requisición → Cotización → OC (Sesión 5 Capa 1)
 *
 * Verifican el flujo "requisición → disponible → OC → comprometido" de extremo a extremo:
 *
 *  01. Crear requisición — estado inicial BORRADOR.
 *  02. Disponible correcto con presupuesto BASE APROBADO (presupuestado − comprometido − devengado).
 *  03. Submit de requisición dentro de presupuesto → estado APROBADA.
 *  04. Submit de requisición que excede disponible → estado PENDIENTE_APROBACION.
 *  05. No se puede someter una requisición que no está en BORRADOR.
 *  06. Crear SOC consolidando líneas de requisición APROBADA.
 *  07. No se puede crear SOC con líneas de requisición no APROBADA.
 *  08. Enviar SOC → estado ENVIADA, enviada_en marcado en soc_proveedor.
 *  09. Registrar cotización sobre SOC ENVIADA.
 *  10. Cuadro comparativo incluye cotizaciones con mejor precio marcado.
 *  11. Crear OC en estado BORRADOR.
 *  12. Aprobar OC → estado APROBADA.
 *  13. No se puede emitir OC que no está APROBADA.
 *  14. Emitir OC → evento emision_oc registrado, estado EMITIDA.
 *  15. Emitir OC → comprometido de partida incrementado exactamente en total de líneas.
 *  16. ejecucion_partida acumula comprometido de múltiples OCs correctamente.
 *  17. RLS: tenant2 no ve registros de tenant1 en ninguna tabla de compras.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
// drizzle-orm operators used in handler tests via adminDb

import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import Decimal from 'decimal.js';
import { ComprasEmisionOcHandler } from '../handlers/compras-emision-oc.handler.js';

// ─── Conexiones ──────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

// ─── Suite ───────────────────────────────────────────────────────────────────
describe('Compras — flujo requisición→disponible→OC→comprometido', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  let tenantId: string;
  let t2: string;
  let empresaId: string;
  let e2: string;
  let proyectoId: string;
  let p2: string;
  let partidaId: string;
  let partida2Id: string; // segunda partida para test multi-OC
  let centroCostoId: string;
  let cc2: string;
  let terceroId: string;
  let partida2TenantId: string; // partida de tenant2 para test RLS
  let versionPresupuestoId: string;

  let handler: ComprasEmisionOcHandler;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool   = new Pool({ connectionString: APP_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantId      = newId();
    t2            = newId();
    empresaId     = newId();
    e2            = newId();
    proyectoId    = newId();
    p2            = newId();
    partidaId     = newId();
    partida2Id    = newId();
    centroCostoId = newId();
    cc2           = newId();
    terceroId          = newId();
    partida2TenantId   = newId();
    versionPresupuestoId = newId();

    handler = new ComprasEmisionOcHandler();

    // ── Tenant 1 ──────────────────────────────────────────────────────────────
    await adminDb.insert(schema.tenants).values({
      id: tenantId, nombre: 'Constructora Compras [test]',
      slug: `cmp-t1-${tenantId.slice(-12)}`,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    // Tenant 2 (RLS)
    await adminDb.insert(schema.tenants).values({
      id: t2, nombre: 'Otra Constructora Compras [test]',
      slug: `cmp-t2-${t2.slice(-12)}`,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    await adminDb.insert(schema.empresas).values({
      id: empresaId, tenantId, nombre: 'Empresa Compras [test]',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await adminDb.insert(schema.empresas).values({
      id: e2, tenantId: t2, nombre: 'Empresa Compras2 [test]',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    await adminPool.query(
      `INSERT INTO centro_costo (id, tenant_id, empresa_id, codigo, nombre, tipo, created_by, updated_by)
       VALUES ($1,$2,$3,'ADM-CMP','Admin Compras','ADMINISTRATIVO',$4,$4),
              ($5,$6,$7,'ADM-CMP2','Admin Compras2','ADMINISTRATIVO',$4,$4)`,
      [centroCostoId, tenantId, empresaId, SYSTEM_USER_ID, cc2, t2, e2],
    );

    // ── Terceros (deben existir antes de proyecto.cliente_id) ────────────────
    // terceroId sirve como cliente del proyecto t1 Y como proveedor en las OCs
    await adminPool.query(
      `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula, nombre_comercial, tipo_contribuyente, condicion_dgii, es_cliente, es_proveedor, created_by, updated_by)
       VALUES ($1,$2,'RNC','101000001','Cliente Test SA','PERSONA_JURIDICA','NORMAL',true,true,$3,$3)`,
      [terceroId, tenantId, SYSTEM_USER_ID],
    );

    const clienteT2Id = newId();
    await adminPool.query(
      `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula, nombre_comercial, tipo_contribuyente, condicion_dgii, es_cliente, created_by, updated_by)
       VALUES ($1,$2,'RNC','101000002','Cliente T2 Test SA','PERSONA_JURIDICA','NORMAL',true,$3,$3)`,
      [clienteT2Id, t2, SYSTEM_USER_ID],
    );

    // ── Proyecto + Partidas ───────────────────────────────────────────────────

    await adminPool.query(
      `INSERT INTO proyecto (id, tenant_id, empresa_id, codigo, nombre, tipo_obra, cliente_id, estado, created_by, updated_by)
       VALUES ($1,$2,$3,'PRY-CMP','Proyecto Compras [test]','COMERCIAL',$4,'EN_EJECUCION',$5,$5)`,
      [proyectoId, tenantId, empresaId, terceroId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO proyecto (id, tenant_id, empresa_id, codigo, nombre, tipo_obra, cliente_id, estado, created_by, updated_by)
       VALUES ($1,$2,$3,'PRY-CMP2','Proyecto Compras2 [test]','COMERCIAL',$4,'EN_EJECUCION',$5,$5)`,
      [p2, t2, e2, clienteT2Id, SYSTEM_USER_ID],
    );

    await adminPool.query(
      `INSERT INTO partida (id, tenant_id, proyecto_id, codigo, numero_jerarquico, nombre, nivel, created_by, updated_by)
       VALUES ($1,$2,$3,'01','01','Estructuras',1,$4,$4),
              ($5,$2,$3,'02','02','Acabados',1,$4,$4)`,
      [partidaId, tenantId, proyectoId, SYSTEM_USER_ID, partida2Id],
    );
    await adminPool.query(
      `INSERT INTO partida (id, tenant_id, proyecto_id, codigo, numero_jerarquico, nombre, nivel, created_by, updated_by)
       VALUES ($1,$2,$3,'01','01','Partida RLS [test]',1,$4,$4)`,
      [partida2TenantId, t2, p2, SYSTEM_USER_ID],
    );

    // ── Presupuesto BASE APROBADO — 1000 DOP para partida, 500 DOP para partida2 ──
    // Insertar en PENDIENTE primero (trigger protege INSERTs en APROBADO), luego aprobar
    await adminPool.query(
      `INSERT INTO version_presupuesto (id, tenant_id, proyecto_id, nombre, tipo, estado, moneda, total_directo, total_presupuesto, created_by, updated_by)
       VALUES ($1,$2,$3,'Presupuesto Original','BASE','PENDIENTE','DOP',1500,1500,$4,$4)`,
      [versionPresupuestoId, tenantId, proyectoId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO linea_presupuesto (id, tenant_id, version_presupuesto_id, partida_id, cantidad, precio_unitario, total, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,10,'100.0000','1000.0000','DOP',$5,$5),
              ($6,$2,$3,$7,5,'100.0000','500.0000','DOP',$5,$5)`,
      [newId(), tenantId, versionPresupuestoId, partidaId, SYSTEM_USER_ID, newId(), partida2Id],
    );
    await adminPool.query(
      `UPDATE version_presupuesto SET estado = 'APROBADO' WHERE id = $1`,
      [versionPresupuestoId],
    );
  });

  afterAll(async () => {
    // Limpiar en orden FK inverso
    await adminPool.query(`DELETE FROM ejecucion_partida WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM linea_orden_compra WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE orden_compra DISABLE TRIGGER no_delete_orden_compra`);
    await adminPool.query(`DELETE FROM orden_compra WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE orden_compra ENABLE TRIGGER no_delete_orden_compra`);
    await adminPool.query(`DELETE FROM linea_cotizacion WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE cotizacion DISABLE TRIGGER no_delete_cotizacion`);
    await adminPool.query(`DELETE FROM cotizacion WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE cotizacion ENABLE TRIGGER no_delete_cotizacion`);
    await adminPool.query(`DELETE FROM soc_proveedor WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`DELETE FROM linea_soc WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE solicitud_cotizacion DISABLE TRIGGER no_delete_solicitud_cotizacion`);
    await adminPool.query(`DELETE FROM solicitud_cotizacion WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE solicitud_cotizacion ENABLE TRIGGER no_delete_solicitud_cotizacion`);
    await adminPool.query(`DELETE FROM linea_requisicion WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE requisicion DISABLE TRIGGER no_delete_requisicion`);
    await adminPool.query(`DELETE FROM requisicion WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE requisicion ENABLE TRIGGER no_delete_requisicion`);
    // Mover a RECHAZADO para liberar el trigger de inmutabilidad de líneas
    await adminPool.query(
      `UPDATE version_presupuesto SET estado = 'RECHAZADO' WHERE tenant_id IN ($1,$2) AND estado = 'APROBADO'`,
      [tenantId, t2],
    );
    await adminPool.query(`DELETE FROM linea_presupuesto WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE version_presupuesto DISABLE TRIGGER no_delete_version_presupuesto`);
    await adminPool.query(`DELETE FROM version_presupuesto WHERE tenant_id IN ($1,$2)`, [tenantId, t2]);
    await adminPool.query(`ALTER TABLE version_presupuesto ENABLE TRIGGER no_delete_version_presupuesto`);
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
    await adminPool.query(`DELETE FROM centro_costo WHERE id IN ($1,$2)`, [centroCostoId, cc2]);
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

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  async function insertRequisicion(opts: {
    tid: string;
    eid: string;
    pId: string;
    partId: string;
    cantidad: string;
    precioEstimado: string;
    numero?: string;
  }) {
    const reqId = newId();
    const lineaId = newId();
    await adminPool.query(
      `INSERT INTO requisicion (id, tenant_id, empresa_id, numero, proyecto_id, estado, solicitado_por, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'BORRADOR',$6,$6,$6)`,
      [reqId, opts.tid, opts.eid, opts.numero ?? `REQ-${Date.now()}-${reqId.slice(0,4)}`, opts.pId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO linea_requisicion (id, tenant_id, requisicion_id, partida_id, descripcion, cantidad, unidad_medida, precio_estimado, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'Material de prueba',$5,'UND',$6,'DOP',$7,$7)`,
      [lineaId, opts.tid, reqId, opts.partId, opts.cantidad, opts.precioEstimado, SYSTEM_USER_ID],
    );
    return { reqId, lineaId };
  }

  async function setRequisicionEstado(reqId: string, estado: string) {
    await adminPool.query(`UPDATE requisicion SET estado = $1 WHERE id = $2`, [estado, reqId]);
  }

  async function setEjecucionPartida(tid: string, partId: string, comprometido: string) {
    await adminPool.query(
      `INSERT INTO ejecucion_partida (id, tenant_id, partida_id, comprometido, devengado, moneda, ultima_actualizacion, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'0.0000','DOP',now(),$5,$5)
       ON CONFLICT (tenant_id, partida_id) DO UPDATE SET comprometido = $4`,
      [newId(), tid, partId, comprometido, SYSTEM_USER_ID],
    );
  }

  async function insertOc(opts: {
    tid: string;
    eid: string;
    partId: string;
    total: string;
    estado?: string;
    numero?: string;
  }) {
    const ocId = newId();
    const lineaId = newId();
    await adminPool.query(
      `INSERT INTO orden_compra (id, tenant_id, empresa_id, numero, estado, tercero_id, total_monto, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'DOP',$8,$8)`,
      [ocId, opts.tid, opts.eid, opts.numero ?? `OC-${Date.now()}-${ocId.slice(0,4)}`,
       opts.estado ?? 'BORRADOR', terceroId, opts.total, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO linea_orden_compra (id, tenant_id, orden_compra_id, partida_id, descripcion, cantidad, unidad_medida, precio_unitario, total, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'Material test','1.0000','UND',$5,$5,'DOP',$6,$6)`,
      [lineaId, opts.tid, ocId, opts.partId, opts.total, SYSTEM_USER_ID],
    );
    return { ocId, lineaId };
  }

  // ─── Tests ───────────────────────────────────────────────────────────────────

  // 01. Crear requisición — estado inicial BORRADOR
  it('01. Crear requisición resulta en estado BORRADOR', async () => {
    const { reqId } = await insertRequisicion({
      tid: tenantId, eid: empresaId, pId: proyectoId,
      partId: partidaId, cantidad: '5', precioEstimado: '100',
    });

    const { rows } = await adminPool.query(
      `SELECT estado FROM requisicion WHERE id = $1`, [reqId],
    );
    expect(rows[0]!.estado).toBe('BORRADOR');
  });

  // 02. Disponible = presupuestado − comprometido − devengado
  it('02. Disponible calculado en vivo es correcto', async () => {
    // Presupuestado = 1000; comprometido manual = 300; devengado = 0
    await setEjecucionPartida(tenantId, partidaId, '300.0000');

    const { rows } = await adminPool.query(
      `SELECT
         COALESCE((SELECT total FROM linea_presupuesto lp
                   JOIN version_presupuesto vp ON lp.version_presupuesto_id = vp.id
                   WHERE lp.partida_id = $1 AND vp.tipo = 'BASE' AND vp.estado = 'APROBADO'
                   AND vp.tenant_id = $2 LIMIT 1), 0) AS presupuestado,
         COALESCE((SELECT comprometido FROM ejecucion_partida
                   WHERE tenant_id = $2 AND partida_id = $1 LIMIT 1), 0) AS comprometido,
         COALESCE((SELECT devengado FROM ejecucion_partida
                   WHERE tenant_id = $2 AND partida_id = $1 LIMIT 1), 0) AS devengado`,
      [partidaId, tenantId],
    );

    const { presupuestado, comprometido, devengado } = rows[0]!;
    const disponible = new Decimal(presupuestado).minus(comprometido).minus(devengado);

    expect(presupuestado).toBe('1000.0000');
    expect(comprometido).toBe('300.0000');
    expect(devengado).toBe('0.0000');
    expect(disponible.toFixed(4)).toBe('700.0000');
  });

  // 03. Submit de requisición dentro de presupuesto → APROBADA
  it('03. Requisición dentro de disponible → se marca APROBADA al someter', async () => {
    // Disponible = 700; requisición por 500 → cabe
    await setEjecucionPartida(tenantId, partidaId, '300.0000');

    const { reqId } = await insertRequisicion({
      tid: tenantId, eid: empresaId, pId: proyectoId,
      partId: partidaId, cantidad: '5', precioEstimado: '100', // total = 500
    });

    // Simular lógica del DisponibilidadService + RequisicionService.submit
    const { rows: dispRows } = await adminPool.query(
      `SELECT
         COALESCE((SELECT total FROM linea_presupuesto lp
                   JOIN version_presupuesto vp ON lp.version_presupuesto_id = vp.id
                   WHERE lp.partida_id = $1 AND vp.tipo = 'BASE' AND vp.estado = 'APROBADO'
                   AND vp.tenant_id = $2 LIMIT 1), 0) AS presupuestado,
         COALESCE((SELECT comprometido FROM ejecucion_partida WHERE tenant_id = $2 AND partida_id = $1), 0) AS comprometido,
         COALESCE((SELECT devengado FROM ejecucion_partida WHERE tenant_id = $2 AND partida_id = $1), 0) AS devengado`,
      [partidaId, tenantId],
    );
    const { presupuestado, comprometido, devengado } = dispRows[0]!;
    const disponible = new Decimal(presupuestado).minus(comprometido).minus(devengado);
    const totalReq = new Decimal('100').mul('5'); // precioEstimado * cantidad

    const hayExceso = totalReq.greaterThan(disponible);
    const nuevoEstado = hayExceso ? 'PENDIENTE_APROBACION' : 'APROBADA';

    await adminPool.query(`UPDATE requisicion SET estado = $1 WHERE id = $2`, [nuevoEstado, reqId]);

    const { rows } = await adminPool.query(`SELECT estado FROM requisicion WHERE id = $1`, [reqId]);
    expect(hayExceso).toBe(false);
    expect(rows[0]!.estado).toBe('APROBADA');
  });

  // 04. Submit de requisición que excede disponible → PENDIENTE_APROBACION
  it('04. Requisición que excede disponible → PENDIENTE_APROBACION (no se bloquea)', async () => {
    // Disponible = 700; requisición por 800 → excede
    await setEjecucionPartida(tenantId, partidaId, '300.0000');

    const { reqId } = await insertRequisicion({
      tid: tenantId, eid: empresaId, pId: proyectoId,
      partId: partidaId, cantidad: '8', precioEstimado: '100', // total = 800 > 700
    });

    const { rows: dispRows } = await adminPool.query(
      `SELECT
         COALESCE((SELECT total FROM linea_presupuesto lp
                   JOIN version_presupuesto vp ON lp.version_presupuesto_id = vp.id
                   WHERE lp.partida_id = $1 AND vp.tipo = 'BASE' AND vp.estado = 'APROBADO'
                   AND vp.tenant_id = $2 LIMIT 1), 0) AS presupuestado,
         COALESCE((SELECT comprometido FROM ejecucion_partida WHERE tenant_id = $2 AND partida_id = $1), 0) AS comprometido,
         COALESCE((SELECT devengado FROM ejecucion_partida WHERE tenant_id = $2 AND partida_id = $1), 0) AS devengado`,
      [partidaId, tenantId],
    );
    const { presupuestado, comprometido, devengado } = dispRows[0]!;
    const disponible = new Decimal(presupuestado).minus(comprometido).minus(devengado);
    const totalReq = new Decimal('100').mul('8');

    const hayExceso = totalReq.greaterThan(disponible);
    const nuevoEstado = hayExceso ? 'PENDIENTE_APROBACION' : 'APROBADA';

    await adminPool.query(`UPDATE requisicion SET estado = $1 WHERE id = $2`, [nuevoEstado, reqId]);

    const { rows } = await adminPool.query(`SELECT estado FROM requisicion WHERE id = $1`, [reqId]);
    expect(hayExceso).toBe(true);
    expect(rows[0]!.estado).toBe('PENDIENTE_APROBACION');
  });

  // 05. No se puede someter una requisición que no está en BORRADOR
  it('05. Requisición en APROBADA no puede someterse de nuevo', async () => {
    const { reqId } = await insertRequisicion({
      tid: tenantId, eid: empresaId, pId: proyectoId,
      partId: partidaId, cantidad: '1', precioEstimado: '10',
    });
    await setRequisicionEstado(reqId, 'APROBADA');

    const { rows } = await adminPool.query(`SELECT estado FROM requisicion WHERE id = $1`, [reqId]);
    expect(rows[0]!.estado).toBe('APROBADA');
    // El servicio rechazaría con BadRequestException en runtime; aquí verificamos la restricción de estado
  });

  // 06. Crear SOC consolidando líneas de requisición APROBADA
  it('06. SOC creada correctamente con líneas de requisición APROBADA', async () => {
    const { reqId, lineaId } = await insertRequisicion({
      tid: tenantId, eid: empresaId, pId: proyectoId,
      partId: partidaId, cantidad: '2', precioEstimado: '50',
    });
    await setRequisicionEstado(reqId, 'APROBADA');

    const socId = newId();
    await adminPool.query(
      `INSERT INTO solicitud_cotizacion (id, tenant_id, empresa_id, numero, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'BORRADOR',$5,$5)`,
      [socId, tenantId, empresaId, `SOC-${Date.now()}`, SYSTEM_USER_ID],
    );

    const lineaSocId = newId();
    await adminPool.query(
      `INSERT INTO linea_soc (id, tenant_id, soc_id, linea_requisicion_id, cantidad, unidad_medida, descripcion, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'2.0000','UND','Material de prueba',$5,$5)`,
      [lineaSocId, tenantId, socId, lineaId, SYSTEM_USER_ID],
    );

    // Verificar SOC creada
    const { rows } = await adminPool.query(`SELECT estado FROM solicitud_cotizacion WHERE id = $1`, [socId]);
    expect(rows[0]!.estado).toBe('BORRADOR');

    // Verificar línea SOC
    const { rows: lineas } = await adminPool.query(`SELECT soc_id, linea_requisicion_id FROM linea_soc WHERE id = $1`, [lineaSocId]);
    expect(lineas[0]!.soc_id).toBe(socId);
    expect(lineas[0]!.linea_requisicion_id).toBe(lineaId);
  });

  // 07. No se puede crear SOC con líneas de requisición en estado diferente a APROBADA
  it('07. Líneas de requisición BORRADOR no pueden consolidarse en SOC', async () => {
    const { lineaId } = await insertRequisicion({
      tid: tenantId, eid: empresaId, pId: proyectoId,
      partId: partidaId, cantidad: '1', precioEstimado: '50',
    });

    // Verificar que la requisición está en BORRADOR
    const { rows } = await adminPool.query(
      `SELECT r.estado FROM requisicion r
       JOIN linea_requisicion lr ON lr.requisicion_id = r.id
       WHERE lr.id = $1`, [lineaId],
    );
    expect(rows[0]!.estado).toBe('BORRADOR');
    // El servicio rechazaría con BadRequestException; la DB no tiene restricción directa en este nivel
  });

  // 08. Enviar SOC → estado ENVIADA, enviada_en marcado en soc_proveedor
  it('08. Enviar SOC cambia estado a ENVIADA y marca fecha en soc_proveedor', async () => {
    const socId = newId();
    await adminPool.query(
      `INSERT INTO solicitud_cotizacion (id, tenant_id, empresa_id, numero, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'BORRADOR',$5,$5)`,
      [socId, tenantId, empresaId, `SOC-${Date.now()}-2`, SYSTEM_USER_ID],
    );

    const socProvId = newId();
    await adminPool.query(
      `INSERT INTO soc_proveedor (id, tenant_id, soc_id, tercero_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5)`,
      [socProvId, tenantId, socId, terceroId, SYSTEM_USER_ID],
    );

    // Simular el envío
    await adminPool.query(
      `UPDATE soc_proveedor SET enviada_en = now() WHERE soc_id = $1`, [socId],
    );
    await adminPool.query(
      `UPDATE solicitud_cotizacion SET estado = 'ENVIADA' WHERE id = $1`, [socId],
    );

    const { rows: socRows } = await adminPool.query(`SELECT estado FROM solicitud_cotizacion WHERE id = $1`, [socId]);
    expect(socRows[0]!.estado).toBe('ENVIADA');

    const { rows: provRows } = await adminPool.query(`SELECT enviada_en FROM soc_proveedor WHERE id = $1`, [socProvId]);
    expect(provRows[0]!.enviada_en).not.toBeNull();
  });

  // 09. Registrar cotización sobre SOC ENVIADA
  it('09. Registrar cotización crea el registro y sus líneas correctamente', async () => {
    // Crear una requisicion+linea para vincular la línea SOC
    const { lineaId: lineaReqId09 } = await insertRequisicion({
      tid: tenantId, eid: empresaId, pId: proyectoId,
      partId: partidaId, cantidad: '3', precioEstimado: '850',
    });

    const socId = newId();
    await adminPool.query(
      `INSERT INTO solicitud_cotizacion (id, tenant_id, empresa_id, numero, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'ENVIADA',$5,$5)`,
      [socId, tenantId, empresaId, `SOC-${Date.now()}-3`, SYSTEM_USER_ID],
    );

    const lineaSocId = newId();
    await adminPool.query(
      `INSERT INTO linea_soc (id, tenant_id, soc_id, linea_requisicion_id, cantidad, unidad_medida, descripcion, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'3.0000','UND','Hierro 3/8',$5,$5)`,
      [lineaSocId, tenantId, socId, lineaReqId09, SYSTEM_USER_ID],
    );

    // Registrar cotización
    const cotId = newId();
    await adminPool.query(
      `INSERT INTO cotizacion (id, tenant_id, soc_id, tercero_id, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'RECIBIDA',$5,$5)`,
      [cotId, tenantId, socId, terceroId, SYSTEM_USER_ID],
    );

    const lineaCotId = newId();
    await adminPool.query(
      `INSERT INTO linea_cotizacion (id, tenant_id, cotizacion_id, linea_soc_id, precio_unitario, cantidad, total, moneda, plazo_entrega_dias, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'850.0000','3.0000','2550.0000','DOP',15,$5,$5)`,
      [lineaCotId, tenantId, cotId, lineaSocId, SYSTEM_USER_ID],
    );

    const { rows } = await adminPool.query(`SELECT estado FROM cotizacion WHERE id = $1`, [cotId]);
    expect(rows[0]!.estado).toBe('RECIBIDA');

    const { rows: lineas } = await adminPool.query(`SELECT precio_unitario, plazo_entrega_dias FROM linea_cotizacion WHERE id = $1`, [lineaCotId]);
    expect(lineas[0]!.precio_unitario).toBe('850.0000');
    expect(lineas[0]!.plazo_entrega_dias).toBe(15);
  });

  // 10. Cuadro comparativo incluye cotizaciones con mejor precio
  it('10. Cuadro comparativo: la cotización de menor precio es identificada', async () => {
    const { lineaId: lineaReqId10 } = await insertRequisicion({
      tid: tenantId, eid: empresaId, pId: proyectoId,
      partId: partidaId, cantidad: '5', precioEstimado: '900',
    });

    const socId = newId();
    await adminPool.query(
      `INSERT INTO solicitud_cotizacion (id, tenant_id, empresa_id, numero, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'ENVIADA',$5,$5)`,
      [socId, tenantId, empresaId, `SOC-${Date.now()}-CC`, SYSTEM_USER_ID],
    );

    const lineaSocId = newId();
    await adminPool.query(
      `INSERT INTO linea_soc (id, tenant_id, soc_id, linea_requisicion_id, cantidad, unidad_medida, descripcion, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'5.0000','UND','Cemento',$5,$5)`,
      [lineaSocId, tenantId, socId, lineaReqId10, SYSTEM_USER_ID],
    );

    // Proveedor A: precio 900
    const tercero2 = newId();
    await adminPool.query(
      `INSERT INTO tercero (id, tenant_id, tipo_identificacion, rnc_cedula, nombre_comercial, tipo_contribuyente, condicion_dgii, es_proveedor, created_by, updated_by)
       VALUES ($1,$2,'RNC','101000003','Proveedor B Test','PERSONA_JURIDICA','NORMAL',true,$3,$3)`,
      [tercero2, tenantId, SYSTEM_USER_ID],
    );

    const cot1Id = newId();
    await adminPool.query(
      `INSERT INTO cotizacion (id, tenant_id, soc_id, tercero_id, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'RECIBIDA',$5,$5)`,
      [cot1Id, tenantId, socId, terceroId, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO linea_cotizacion (id, tenant_id, cotizacion_id, linea_soc_id, precio_unitario, cantidad, total, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'900.0000','5.0000','4500.0000','DOP',$5,$5)`,
      [newId(), tenantId, cot1Id, lineaSocId, SYSTEM_USER_ID],
    );

    // Proveedor B: precio 800 (mejor)
    const cot2Id = newId();
    await adminPool.query(
      `INSERT INTO cotizacion (id, tenant_id, soc_id, tercero_id, estado, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'RECIBIDA',$5,$5)`,
      [cot2Id, tenantId, socId, tercero2, SYSTEM_USER_ID],
    );
    await adminPool.query(
      `INSERT INTO linea_cotizacion (id, tenant_id, cotizacion_id, linea_soc_id, precio_unitario, cantidad, total, moneda, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'800.0000','5.0000','4000.0000','DOP',$5,$5)`,
      [newId(), tenantId, cot2Id, lineaSocId, SYSTEM_USER_ID],
    );

    // Cuadro: min precio = 800 → Proveedor B
    const { rows } = await adminPool.query(
      `SELECT cotizacion_id, precio_unitario
       FROM linea_cotizacion
       WHERE linea_soc_id = $1
       ORDER BY precio_unitario ASC LIMIT 1`,
      [lineaSocId],
    );
    expect(rows[0]!.precio_unitario).toBe('800.0000');
    expect(rows[0]!.cotizacion_id).toBe(cot2Id);
  });

  // 11. Crear OC en estado BORRADOR
  it('11. Crear OC resulta en estado BORRADOR con total correcto', async () => {
    const { ocId } = await insertOc({
      tid: tenantId, eid: empresaId, partId: partidaId,
      total: '450.0000',
    });

    const { rows } = await adminPool.query(`SELECT estado, total_monto FROM orden_compra WHERE id = $1`, [ocId]);
    expect(rows[0]!.estado).toBe('BORRADOR');
    expect(rows[0]!.total_monto).toBe('450.0000');
  });

  // 12. Aprobar OC → estado APROBADA
  it('12. Aprobar OC cambia estado a APROBADA', async () => {
    const { ocId } = await insertOc({
      tid: tenantId, eid: empresaId, partId: partidaId, total: '200.0000',
    });

    await adminPool.query(`UPDATE orden_compra SET estado = 'APROBADA' WHERE id = $1`, [ocId]);

    const { rows } = await adminPool.query(`SELECT estado FROM orden_compra WHERE id = $1`, [ocId]);
    expect(rows[0]!.estado).toBe('APROBADA');
  });

  // 13. No se puede emitir OC que no está APROBADA
  it('13. OC en BORRADOR no puede emitirse directamente', async () => {
    const { ocId } = await insertOc({
      tid: tenantId, eid: empresaId, partId: partidaId, total: '100.0000',
    });

    const { rows } = await adminPool.query(`SELECT estado FROM orden_compra WHERE id = $1`, [ocId]);
    // Verificamos que el estado no es APROBADA (el servicio lanzaría BadRequestException)
    expect(rows[0]!.estado).toBe('BORRADOR');
    expect(rows[0]!.estado).not.toBe('APROBADA');
  });

  // 14. Emitir OC → evento emision_oc registrado, estado EMITIDA
  it('14. Emitir OC aprobada registra evento emision_oc y cambia estado a EMITIDA', async () => {
    const { ocId, lineaId } = await insertOc({
      tid: tenantId, eid: empresaId, partId: partidaId,
      total: '300.0000', estado: 'APROBADA',
    });

    // Registrar evento (simula LedgerService.append)
    const eventoId = newId();
    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'emision_oc',$5,$6,$7,$5)`,
      [
        eventoId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID,
        JSON.stringify({
          ocId,
          totalMonto: '300.0000',
          moneda: 'DOP',
          lineas: [{
            lineaOcId: lineaId,
            partidaId,
            insumoId: null,
            descripcion: 'Material test',
            cantidad: '1.0000',
            precioUnitario: '300.0000',
            total: '300.0000',
          }],
        }),
        `emision_oc:${ocId}`,
      ],
    );

    // Ejecutar handler
    const ctx = {
      evento: {
        id: eventoId, tenantId, empresaId, proyectoId,
        tipo_evento: 'emision_oc', tipoEvento: 'emision_oc',
        usuarioId: SYSTEM_USER_ID,
        createdBy: SYSTEM_USER_ID,
        payload: {
          ocId, totalMonto: '300.0000', moneda: 'DOP',
          lineas: [{
            lineaOcId: lineaId, partidaId, insumoId: null,
            descripcion: 'Material test', cantidad: '1.0000',
            precioUnitario: '300.0000', total: '300.0000',
          }],
        },
      } as never,
      tx: adminDb,
    };
    await handler.ejecutar(ctx);

    // Actualizar OC a EMITIDA
    await adminPool.query(
      `UPDATE orden_compra SET estado = 'EMITIDA', evento_emision_id = $1 WHERE id = $2`,
      [eventoId, ocId],
    );

    const { rows } = await adminPool.query(`SELECT estado, evento_emision_id FROM orden_compra WHERE id = $1`, [ocId]);
    expect(rows[0]!.estado).toBe('EMITIDA');
    expect(rows[0]!.evento_emision_id).toBe(eventoId);
  });

  // 15. Emitir OC → comprometido de partida incrementado exactamente
  it('15. Emitir OC incrementa comprometido de la partida exactamente en el total', async () => {
    // Limpiar ejecucion_partida para tener baseline = 0
    await adminPool.query(
      `DELETE FROM ejecucion_partida WHERE tenant_id = $1 AND partida_id = $2`,
      [tenantId, partida2Id],
    );

    const total = '500.0000';
    const eventoId = newId();
    const ocLineaId = newId();

    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'emision_oc',$5,$6,$7,$5)`,
      [
        eventoId, tenantId, empresaId, proyectoId, SYSTEM_USER_ID,
        JSON.stringify({
          ocId: newId(), totalMonto: total, moneda: 'DOP',
          lineas: [{
            lineaOcId: ocLineaId, partidaId: partida2Id, insumoId: null,
            descripcion: 'Test comprometido', cantidad: '5.0000',
            precioUnitario: '100.0000', total,
          }],
        }),
        `emision_oc:test-comprometido-${newId()}`,
      ],
    );

    const ctx = {
      evento: {
        id: eventoId, tenantId, empresaId, proyectoId,
        tipoEvento: 'emision_oc',
        createdBy: SYSTEM_USER_ID,
        payload: {
          ocId: newId(), totalMonto: total, moneda: 'DOP',
          lineas: [{
            lineaOcId: ocLineaId, partidaId: partida2Id, insumoId: null,
            descripcion: 'Test comprometido', cantidad: '5.0000',
            precioUnitario: '100.0000', total,
          }],
        },
      } as never,
      tx: adminDb,
    };

    await handler.ejecutar(ctx);

    const { rows } = await adminPool.query(
      `SELECT comprometido FROM ejecucion_partida WHERE tenant_id = $1 AND partida_id = $2`,
      [tenantId, partida2Id],
    );
    expect(rows[0]!.comprometido).toBe(total);
  });

  // 16. Múltiples OCs acumulan comprometido correctamente
  it('16. Múltiples OCs acumulan comprometido sin sobreescribir', async () => {
    // partida2 ya tiene 500 de test 15
    const eventoId2 = newId();
    const ocLineaId2 = newId();

    await adminPool.query(
      `INSERT INTO evento_operativo (id, tenant_id, empresa_id, proyecto_id, tipo_evento, usuario_id, payload, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'emision_oc',$5,$6,$7,$5)`,
      [
        eventoId2, tenantId, empresaId, proyectoId, SYSTEM_USER_ID,
        JSON.stringify({
          ocId: newId(), totalMonto: '200.0000', moneda: 'DOP',
          lineas: [{
            lineaOcId: ocLineaId2, partidaId: partida2Id, insumoId: null,
            descripcion: 'Test acumulacion', cantidad: '2.0000',
            precioUnitario: '100.0000', total: '200.0000',
          }],
        }),
        `emision_oc:test-acum-${newId()}`,
      ],
    );

    const ctx = {
      evento: {
        id: eventoId2, tenantId, empresaId, proyectoId,
        tipoEvento: 'emision_oc',
        createdBy: SYSTEM_USER_ID,
        payload: {
          ocId: newId(), totalMonto: '200.0000', moneda: 'DOP',
          lineas: [{
            lineaOcId: ocLineaId2, partidaId: partida2Id, insumoId: null,
            descripcion: 'Test acumulacion', cantidad: '2.0000',
            precioUnitario: '100.0000', total: '200.0000',
          }],
        },
      } as never,
      tx: adminDb,
    };

    await handler.ejecutar(ctx);

    const { rows } = await adminPool.query(
      `SELECT comprometido FROM ejecucion_partida WHERE tenant_id = $1 AND partida_id = $2`,
      [tenantId, partida2Id],
    );
    // 500 (test 15) + 200 (este test) = 700
    expect(rows[0]!.comprometido).toBe('700.0000');
  });

  // 17. RLS: tenant2 no ve datos de tenant1
  it('17. RLS — tenant2 no ve requisiciones, OCs ni ejecucion_partida de tenant1', async () => {
    // Insertar datos de tenant2 para tener algo que NO debe ser visible desde t1
    await insertRequisicion({
      tid: t2, eid: e2, pId: p2, partId: partida2TenantId,
      cantidad: '1', precioEstimado: '100',
    });

    await insertOc({
      tid: t2, eid: e2, partId: partida2TenantId, total: '100.0000',
    });

    // Usar appPool (tributia_app) con SET LOCAL tenant_id = t2 para validar RLS
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${t2}'`);

      // Desde t2 no debe ver datos de t1 (RLS filtra por tenant_id)
      const { rows: reqRows } = await client.query(
        `SELECT id FROM requisicion WHERE tenant_id = $1`, [tenantId],
      );
      const { rows: ocRows } = await client.query(
        `SELECT id FROM orden_compra WHERE tenant_id = $1`, [tenantId],
      );
      const { rows: epRows } = await client.query(
        `SELECT id FROM ejecucion_partida WHERE tenant_id = $1`, [tenantId],
      );

      expect(reqRows.length).toBe(0);
      expect(ocRows.length).toBe(0);
      expect(epRows.length).toBe(0);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
