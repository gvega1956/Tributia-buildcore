import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and, sql } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { partidas } from '../db/schema/proyectos/partida.js';
import { versionesPresupuesto, lineasPresupuesto } from '../db/schema/proyectos/presupuesto.js';
import { ejecucionPartidas } from '../db/schema/compras/ejecucion_partida.js';

// ── Tipos públicos del tablero ────────────────────────────────────────────────

export interface TableroPartidaRow {
  partidaId: string;
  codigo: string;
  nombre: string;
  nivel: number;
  numeroJerarquico: string;
  presupuestoVigente: string;
  comprometido: string;
  devengado: string;
  pagado: string;
  disponible: string;
  avancePct: string;
  ev: string;
  ac: string;
  cpi: string | null;
  spi: string | null;
  alerta: 'VERDE' | 'AMARILLO' | 'ROJO';
}

export interface TableroProyecto {
  proyectoId: string;
  presupuestoVigente: string;
  comprometido: string;
  devengado: string;
  pagado: string;
  disponible: string;
  avancePct: string;
  ev: string;
  ac: string;
  cpi: string | null;
  spi: string | null;
  alerta: 'VERDE' | 'AMARILLO' | 'ROJO';
  partidas: TableroPartidaRow[];
}

export interface CurvaSPoint {
  semana: string;
  evAcumulado: string;
  acAcumulado: string;
}

export interface TrazabilidadRow {
  eventoId: string;
  tipoEvento: string;
  ocurridoEn: string;
  referenciaTabla: string | null;
  referenciaId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class TableroService {
  constructor(private readonly db: DbService) {}

  /**
   * Tablero completo del proyecto: tríada + EVM por partida, más resumen agregado.
   */
  async tableroProyecto(tenantId: string, proyectoId: string): Promise<TableroProyecto> {
    const filas = await this.tableroPartidas(tenantId, proyectoId);

    let sumVigente = new Decimal(0);
    let sumComprometido = new Decimal(0);
    let sumDevengado = new Decimal(0);
    let sumPagado = new Decimal(0);
    let sumEv = new Decimal(0);
    let sumAc = new Decimal(0);

    for (const f of filas) {
      sumVigente = sumVigente.plus(f.presupuestoVigente);
      sumComprometido = sumComprometido.plus(f.comprometido);
      sumDevengado = sumDevengado.plus(f.devengado);
      sumPagado = sumPagado.plus(f.pagado);
      sumEv = sumEv.plus(f.ev);
      sumAc = sumAc.plus(f.ac);
    }

    const sumDisponible = sumVigente.minus(sumComprometido).minus(sumDevengado);
    const avancePct = sumVigente.gt(0) ? sumEv.div(sumVigente).mul(100) : new Decimal(0);
    const cpiTotal = sumAc.gt(0) ? sumEv.div(sumAc) : null;
    const spiTotal = sumVigente.gt(0) ? sumEv.div(sumVigente) : null;

    return {
      proyectoId,
      presupuestoVigente: sumVigente.toFixed(4),
      comprometido: sumComprometido.toFixed(4),
      devengado: sumDevengado.toFixed(4),
      pagado: sumPagado.toFixed(4),
      disponible: sumDisponible.toFixed(4),
      avancePct: avancePct.toFixed(2),
      ev: sumEv.toFixed(4),
      ac: sumAc.toFixed(4),
      cpi: cpiTotal?.toFixed(4) ?? null,
      spi: spiTotal?.toFixed(4) ?? null,
      alerta: this.computeAlert(cpiTotal, sumDisponible, sumVigente),
      partidas: filas,
    };
  }

  /**
   * Tríada + EVM por partida para el proyecto.
   * Presupuesto vigente = linea_presupuesto BASE + ejecucion_partida.presupuesto_adicional_oc
   */
  async tableroPartidas(tenantId: string, proyectoId: string): Promise<TableroPartidaRow[]> {
    // Buscar versión BASE aprobada del proyecto
    const [baseVersion] = await this.db.tx
      .select({ id: versionesPresupuesto.id })
      .from(versionesPresupuesto)
      .where(
        and(
          eq(versionesPresupuesto.tenantId, tenantId),
          eq(versionesPresupuesto.proyectoId, proyectoId),
          eq(versionesPresupuesto.tipo, 'BASE'),
          eq(versionesPresupuesto.estado, 'APROBADO'),
        ),
      )
      .limit(1);

    const lpJoin = baseVersion
      ? and(
          eq(lineasPresupuesto.partidaId, partidas.id),
          eq(lineasPresupuesto.versionPresupuestoId, baseVersion.id),
        )
      : and(eq(lineasPresupuesto.partidaId, partidas.id), sql`false`);

    const rows = await this.db.tx
      .select({
        partidaId: partidas.id,
        codigo: partidas.codigo,
        nombre: partidas.nombre,
        nivel: partidas.nivel,
        numeroJerarquico: partidas.numeroJerarquico,
        cantidadBase: partidas.cantidadPresupuestada,
        presupuestoBase: lineasPresupuesto.total,
        comprometido: ejecucionPartidas.comprometido,
        devengado: ejecucionPartidas.devengado,
        pagado: ejecucionPartidas.pagado,
        avanceCantidad: ejecucionPartidas.avanceCantidad,
        presupuestoAdicionalOc: ejecucionPartidas.presupuestoAdicionalOc,
        cantidadAdicionalOc: ejecucionPartidas.cantidadAdicionalOc,
      })
      .from(partidas)
      .leftJoin(lineasPresupuesto, lpJoin)
      .leftJoin(
        ejecucionPartidas,
        and(
          eq(ejecucionPartidas.partidaId, partidas.id),
          eq(ejecucionPartidas.tenantId, tenantId),
        ),
      )
      .where(and(eq(partidas.proyectoId, proyectoId), eq(partidas.tenantId, tenantId)))
      .orderBy(partidas.numeroJerarquico);

    return rows.map((row) => this.computeMetrics(row));
  }

  /**
   * Curva S del proyecto: EV y AC acumulados por semana.
   * EV = cantidadEjecutada × (linea.total / linea.cantidad)  — desde avance_obra
   * AC = costoTotal de movimientos SALIDA por semana           — desde movimiento_inventario
   */
  async curvaS(tenantId: string, proyectoId: string): Promise<CurvaSPoint[]> {
    const result = await this.db.tx.execute(sql`
      WITH base_lineas AS (
        SELECT
          lp.partida_id,
          lp.total::numeric       AS total_linea,
          lp.cantidad::numeric    AS cantidad_linea
        FROM linea_presupuesto lp
        JOIN version_presupuesto vp ON lp.version_presupuesto_id = vp.id
        WHERE vp.tenant_id    = ${tenantId}::uuid
          AND vp.proyecto_id  = ${proyectoId}::uuid
          AND vp.tipo         = 'BASE'
          AND vp.estado       = 'APROBADO'
      ),
      ep_deltas AS (
        SELECT ep.partida_id, ep.cantidad_adicional_oc::numeric AS cantidad_oc
        FROM ejecucion_partida ep
        WHERE ep.tenant_id = ${tenantId}::uuid
      ),
      ev_semanal AS (
        SELECT
          date_trunc('week', ao.created_at)::date AS semana,
          SUM(
            ao.cantidad_ejecutada::numeric *
            COALESCE(bl.total_linea, 0) /
            NULLIF(COALESCE(bl.cantidad_linea, 0) + COALESCE(epd.cantidad_oc, 0), 0)
          ) AS ev_semana
        FROM avance_obra ao
        JOIN partida p ON p.id = ao.partida_id AND p.proyecto_id = ${proyectoId}::uuid
        LEFT JOIN base_lineas  bl  ON bl.partida_id  = ao.partida_id
        LEFT JOIN ep_deltas    epd ON epd.partida_id = ao.partida_id
        WHERE ao.tenant_id = ${tenantId}::uuid
        GROUP BY semana
      ),
      ac_semanal AS (
        SELECT
          date_trunc('week', mi.created_at)::date AS semana,
          SUM(mi.costo_total::numeric) AS ac_semana
        FROM movimiento_inventario mi
        WHERE mi.tenant_id = ${tenantId}::uuid
          AND mi.partida_id IS NOT NULL
          AND mi.tipo_movimiento IN ('SALIDA', 'AJUSTE_SALIDA')
          AND EXISTS (
            SELECT 1 FROM partida p
            WHERE p.id = mi.partida_id AND p.proyecto_id = ${proyectoId}::uuid
          )
        GROUP BY semana
      ),
      all_weeks AS (
        SELECT semana FROM ev_semanal
        UNION
        SELECT semana FROM ac_semanal
      )
      SELECT
        aw.semana,
        COALESCE(ev.ev_semana, 0) AS ev_semana,
        COALESCE(ac.ac_semana, 0) AS ac_semana
      FROM all_weeks aw
      LEFT JOIN ev_semanal ev ON ev.semana = aw.semana
      LEFT JOIN ac_semanal ac ON ac.semana = aw.semana
      ORDER BY aw.semana
    `);

    // Convertir a acumulado
    let evAcum = new Decimal(0);
    let acAcum = new Decimal(0);

    return (result.rows as Array<{ semana: Date; ev_semana: string; ac_semana: string }>).map(
      (row) => {
        evAcum = evAcum.plus(new Decimal(row.ev_semana ?? '0'));
        acAcum = acAcum.plus(new Decimal(row.ac_semana ?? '0'));
        return {
          semana: row.semana instanceof Date
            ? row.semana.toISOString().slice(0, 10)
            : String(row.semana),
          evAcumulado: evAcum.toFixed(4),
          acAcumulado: acAcum.toFixed(4),
        };
      },
    );
  }

  /**
   * Trazabilidad P8: eventos que afectaron una partida, enlazando al documento origen.
   */
  async trazabilidadPartida(
    tenantId: string,
    partidaId: string,
    limit = 50,
  ): Promise<TrazabilidadRow[]> {
    const result = await this.db.tx.execute(sql`
      SELECT DISTINCT
        eo.id              AS evento_id,
        eo.tipo_evento,
        eo.ocurrido_en,
        eo.referencia_tabla,
        eo.referencia_id
      FROM evento_operativo eo
      WHERE eo.tenant_id = ${tenantId}::uuid
        AND (
          -- Avance físico registrado para esta partida
          EXISTS (
            SELECT 1 FROM avance_obra ao
            WHERE ao.evento_id = eo.id AND ao.partida_id = ${partidaId}::uuid
          )
          OR
          -- Movimiento de inventario (consumo/recepción) para esta partida
          EXISTS (
            SELECT 1 FROM movimiento_inventario mi
            WHERE mi.evento_operativo_id = eo.id AND mi.partida_id = ${partidaId}::uuid
          )
          OR
          -- Recepción de OC con líneas para esta partida
          EXISTS (
            SELECT 1 FROM linea_recepcion_oc lro
            JOIN recepcion_oc ro ON lro.recepcion_oc_id = ro.id
            WHERE lro.partida_id = ${partidaId}::uuid
              AND ro.evento_recepcion_id = eo.id
              AND lro.tenant_id = ${tenantId}::uuid
          )
          OR
          -- Orden de cambio aprobada que afecta esta partida
          EXISTS (
            SELECT 1 FROM linea_orden_cambio loc
            JOIN orden_cambio oc ON loc.orden_cambio_id = oc.id
            WHERE loc.partida_id = ${partidaId}::uuid
              AND oc.evento_id = eo.id
              AND loc.tenant_id = ${tenantId}::uuid
          )
        )
      ORDER BY eo.ocurrido_en DESC
      LIMIT ${limit}
    `);

    return (
      result.rows as Array<{
        evento_id: string;
        tipo_evento: string;
        ocurrido_en: Date;
        referencia_tabla: string | null;
        referencia_id: string | null;
      }>
    ).map((row) => ({
      eventoId: row.evento_id,
      tipoEvento: row.tipo_evento,
      ocurridoEn: row.ocurrido_en instanceof Date
        ? row.ocurrido_en.toISOString()
        : String(row.ocurrido_en),
      referenciaTabla: row.referencia_tabla,
      referenciaId: row.referencia_id,
    }));
  }

  // ── Métricas internas ───────────────────────────────────────────────────────

  private computeMetrics(row: {
    partidaId: string;
    codigo: string;
    nombre: string;
    nivel: number;
    numeroJerarquico: string;
    cantidadBase: string | null;
    presupuestoBase: string | null;
    comprometido: string | null;
    devengado: string | null;
    pagado: string | null;
    avanceCantidad: string | null;
    presupuestoAdicionalOc: string | null;
    cantidadAdicionalOc: string | null;
  }): TableroPartidaRow {
    const presupuestoBase = new Decimal(row.presupuestoBase ?? '0');
    const presupuestoAdicionalOc = new Decimal(row.presupuestoAdicionalOc ?? '0');
    const presupuestoVigente = presupuestoBase.plus(presupuestoAdicionalOc);

    const cantidadBase = new Decimal(row.cantidadBase ?? '0');
    const cantidadAdicionalOc = new Decimal(row.cantidadAdicionalOc ?? '0');
    const cantidadVigente = cantidadBase.plus(cantidadAdicionalOc);

    const comprometido = new Decimal(row.comprometido ?? '0');
    const devengado = new Decimal(row.devengado ?? '0');
    const pagado = new Decimal(row.pagado ?? '0');
    const disponible = presupuestoVigente.minus(comprometido).minus(devengado);

    const avanceCantidad = new Decimal(row.avanceCantidad ?? '0');
    const avancePct = cantidadVigente.gt(0)
      ? avanceCantidad.div(cantidadVigente)
      : new Decimal(0);

    // Valor Ganado (EVM)
    const pv = presupuestoVigente;
    const ev = pv.mul(avancePct);
    const ac = devengado;
    const cpi = ac.gt(0) ? ev.div(ac) : null;
    const spi = pv.gt(0) ? ev.div(pv) : null;

    return {
      partidaId: row.partidaId,
      codigo: row.codigo,
      nombre: row.nombre,
      nivel: row.nivel,
      numeroJerarquico: row.numeroJerarquico,
      presupuestoVigente: presupuestoVigente.toFixed(4),
      comprometido: comprometido.toFixed(4),
      devengado: devengado.toFixed(4),
      pagado: pagado.toFixed(4),
      disponible: disponible.toFixed(4),
      avancePct: avancePct.mul(100).toFixed(2),
      ev: ev.toFixed(4),
      ac: ac.toFixed(4),
      cpi: cpi?.toFixed(4) ?? null,
      spi: spi?.toFixed(4) ?? null,
      alerta: this.computeAlert(cpi, disponible, presupuestoVigente),
    };
  }

  private computeAlert(
    cpi: Decimal | null,
    disponible: Decimal,
    vigente: Decimal,
  ): 'VERDE' | 'AMARILLO' | 'ROJO' {
    // ROJO: disponible negativo O CPI muy bajo (< 0.75)
    if (disponible.lt(0)) return 'ROJO';
    if (cpi !== null && cpi.lt('0.75')) return 'ROJO';

    // AMARILLO: disponible < 10% del vigente O CPI bajo (< 0.90)
    const umbralDisponible = vigente.mul('0.10');
    if (disponible.lt(umbralDisponible)) return 'AMARILLO';
    if (cpi !== null && cpi.lt('0.90')) return 'AMARILLO';

    return 'VERDE';
  }
}
