import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { DbService } from '../database/db.service.js';
import { asientosContables } from '../db/schema/contabilidad/asiento_contable.js';
import { lineasAsiento } from '../db/schema/contabilidad/linea_asiento.js';
import { cuentasContables } from '../db/schema/contabilidad/cuenta_contable.js';
import { eventosOperativos } from '../db/schema/ledger/evento_operativo.js';

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface LineaLibroDiario {
  cuentaCodigo: string;
  cuentaNombre: string;
  tipo: 'debe' | 'haber';
  importe: string;
  moneda: string;
}

export interface FilaLibroDiario {
  asientoId: string;
  numero: string;
  fecha: string;
  tipo: string;
  descripcion: string;
  eventoId: string | null;
  proyectoId: string | null;
  lineas: LineaLibroDiario[];
}

export interface MovimientoCuenta {
  fecha: string;
  asientoId: string;
  numero: string;
  descripcion: string;
  debe: string;
  haber: string;
  saldoAcumulado: string;
}

export interface LibroMayor {
  cuenta: { id: string; codigo: string; nombre: string; tipo: string; naturaleza: string };
  saldoInicial: string;
  movimientos: MovimientoCuenta[];
  saldoFinal: string;
}

export interface LineaBalanza {
  cuentaCodigo: string;
  cuentaNombre: string;
  tipoCuenta: string;
  totalDebe: string;
  totalHaber: string;
  saldoDeudor: string;
  saldoAcreedor: string;
}

export interface Balanza {
  empresaId: string;
  periodo: { desde: string; hasta: string };
  lineas: LineaBalanza[];
  totalDebe: string;
  totalHaber: string;
  cuadra: boolean;
}

export interface DetalleAsiento {
  id: string;
  numero: string;
  fecha: string;
  tipo: string;
  estado: string;
  descripcion: string;
  aprobadoPor: string | null;
  eventoId: string | null;
  reglaId: string | null;
  /** Trazabilidad P8: datos del evento origen */
  eventoOrigen: {
    tipoEvento: string;
    ocurridoEn: Date;
    usuarioId: string;
    proyectoId: string | null;
    centroCostoId: string | null;
  } | null;
  lineas: LineaLibroDiario[];
  totalDebe: string;
  totalHaber: string;
}

// ─── Servicio ────────────────────────────────────────────────────────────────

@Injectable()
export class LibroContableService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Libro Diario: lista los asientos del período con sus líneas y trazabilidad.
   * Filtros opcionales: cuentaId (muestra solo asientos que tocan esa cuenta),
   * proyectoId (via evento_operativo.proyecto_id — solo asientos automáticos).
   */
  async libroDiario(
    empresaId: string,
    opts: { fechaDesde: string; fechaHasta: string; cuentaId?: string; proyectoId?: string },
  ): Promise<FilaLibroDiario[]> {
    const rows = await this.dbService.tx
      .select({
        asientoId: asientosContables.id,
        numero: asientosContables.numero,
        fecha: asientosContables.fecha,
        tipo: asientosContables.tipo,
        descripcion: asientosContables.descripcion,
        eventoId: asientosContables.eventoId,
        proyectoId: eventosOperativos.proyectoId,
        lineaId: lineasAsiento.id,
        lineaTipo: lineasAsiento.tipo,
        importe: lineasAsiento.importe,
        moneda: lineasAsiento.moneda,
        cuentaCodigo: cuentasContables.codigo,
        cuentaNombre: cuentasContables.nombre,
        lineaCuentaId: lineasAsiento.cuentaId,
      })
      .from(asientosContables)
      .leftJoin(eventosOperativos, eq(eventosOperativos.id, asientosContables.eventoId))
      .innerJoin(lineasAsiento, eq(lineasAsiento.asientoId, asientosContables.id))
      .innerJoin(cuentasContables, eq(cuentasContables.id, lineasAsiento.cuentaId))
      .where(and(
        eq(asientosContables.empresaId, empresaId),
        gte(asientosContables.fecha, opts.fechaDesde),
        lte(asientosContables.fecha, opts.fechaHasta),
        opts.cuentaId ? eq(lineasAsiento.cuentaId, opts.cuentaId) : undefined,
        opts.proyectoId ? eq(eventosOperativos.proyectoId, opts.proyectoId) : undefined,
      ))
      .orderBy(asientosContables.fecha, asientosContables.numero, asientosContables.id);

    // Agrupar líneas por asiento
    const mapa = new Map<string, FilaLibroDiario>();
    for (const r of rows) {
      let asiento = mapa.get(r.asientoId);
      if (!asiento) {
        asiento = {
          asientoId: r.asientoId,
          numero: r.numero,
          fecha: r.fecha,
          tipo: r.tipo,
          descripcion: r.descripcion,
          eventoId: r.eventoId,
          proyectoId: r.proyectoId ?? null,
          lineas: [],
        };
        mapa.set(r.asientoId, asiento);
      }
      asiento.lineas.push({
        cuentaCodigo: r.cuentaCodigo,
        cuentaNombre: r.cuentaNombre,
        tipo: r.lineaTipo as 'debe' | 'haber',
        importe: r.importe,
        moneda: r.moneda,
      });
    }
    return Array.from(mapa.values());
  }

  /**
   * Libro Mayor: movimientos de una cuenta con saldo acumulado (saldo corredor).
   * La cuenta debe pertenecer a la empresa dada.
   */
  async libroMayor(
    empresaId: string,
    cuentaId: string,
    opts: { fechaDesde: string; fechaHasta: string },
  ): Promise<LibroMayor> {
    const [cuenta] = await this.dbService.tx
      .select()
      .from(cuentasContables)
      .where(and(
        eq(cuentasContables.id, cuentaId),
        eq(cuentasContables.empresaId, empresaId),
        eq(cuentasContables.activo, true),
      ))
      .limit(1);

    if (!cuenta) throw new NotFoundException(`Cuenta ${cuentaId} no encontrada en la empresa.`);

    const rows = await this.dbService.tx
      .select({
        fecha: asientosContables.fecha,
        asientoId: asientosContables.id,
        numero: asientosContables.numero,
        descripcion: asientosContables.descripcion,
        tipo: lineasAsiento.tipo,
        importe: lineasAsiento.importe,
      })
      .from(lineasAsiento)
      .innerJoin(asientosContables, eq(asientosContables.id, lineasAsiento.asientoId))
      .where(and(
        eq(lineasAsiento.cuentaId, cuentaId),
        eq(asientosContables.empresaId, empresaId),
        gte(asientosContables.fecha, opts.fechaDesde),
        lte(asientosContables.fecha, opts.fechaHasta),
      ))
      .orderBy(asientosContables.fecha, asientosContables.numero);

    let saldo = new Decimal(0);
    const movimientos: MovimientoCuenta[] = [];

    // Agrupar filas por asiento_id para consolidar debe/haber por asiento
    const porAsiento = new Map<string, { fecha: string; asientoId: string; numero: string; descripcion: string; debe: Decimal; haber: Decimal }>();
    for (const r of rows) {
      let entry = porAsiento.get(r.asientoId);
      if (!entry) {
        entry = { fecha: r.fecha, asientoId: r.asientoId, numero: r.numero, descripcion: r.descripcion, debe: new Decimal(0), haber: new Decimal(0) };
        porAsiento.set(r.asientoId, entry);
      }
      if (r.tipo === 'debe') entry.debe = entry.debe.plus(r.importe);
      else entry.haber = entry.haber.plus(r.importe);
    }

    for (const e of porAsiento.values()) {
      saldo = saldo.plus(e.debe).minus(e.haber);
      movimientos.push({
        fecha: e.fecha,
        asientoId: e.asientoId,
        numero: e.numero,
        descripcion: e.descripcion,
        debe: e.debe.toFixed(4),
        haber: e.haber.toFixed(4),
        saldoAcumulado: saldo.toFixed(4),
      });
    }

    return {
      cuenta: { id: cuenta.id, codigo: cuenta.codigo, nombre: cuenta.nombre, tipo: cuenta.tipo, naturaleza: cuenta.naturaleza },
      saldoInicial: '0.0000',
      movimientos,
      saldoFinal: saldo.toFixed(4),
    };
  }

  /**
   * Balanza de Comprobación: saldos por cuenta en el período.
   * Invariante: totalDebe === totalHaber (cuadra = true) si los asientos balancean.
   */
  async balanza(
    empresaId: string,
    opts: { fechaDesde: string; fechaHasta: string },
  ): Promise<Balanza> {
    // Subconsulta: lineas dentro del período para las cuentas de la empresa
    const result = await this.dbService.tx.execute(sql`
      SELECT
        cc.id AS cuenta_id,
        cc.codigo,
        cc.nombre,
        cc.tipo,
        cc.naturaleza,
        COALESCE(SUM(CASE WHEN la.tipo = 'debe'  THEN la.importe::numeric ELSE 0 END), 0)::text AS total_debe,
        COALESCE(SUM(CASE WHEN la.tipo = 'haber' THEN la.importe::numeric ELSE 0 END), 0)::text AS total_haber
      FROM cuenta_contable cc
      LEFT JOIN (
        SELECT la2.*
        FROM linea_asiento la2
        JOIN asiento_contable ac2 ON ac2.id = la2.asiento_id
        WHERE ac2.empresa_id = ${empresaId}
          AND ac2.fecha BETWEEN ${opts.fechaDesde}::date AND ${opts.fechaHasta}::date
      ) la ON la.cuenta_id = cc.id
      WHERE cc.empresa_id = ${empresaId}
        AND cc.activo = true
        AND cc.es_movimiento = true
      GROUP BY cc.id, cc.codigo, cc.nombre, cc.tipo, cc.naturaleza
      ORDER BY cc.codigo
    `);

    type Row = { codigo: string; nombre: string; tipo: string; naturaleza: string; total_debe: string; total_haber: string };
    let totalDebe = new Decimal(0);
    let totalHaber = new Decimal(0);

    const lineas: LineaBalanza[] = (result.rows as Row[]).map((r) => {
      const debe  = new Decimal(r.total_debe);
      const haber = new Decimal(r.total_haber);
      totalDebe  = totalDebe.plus(debe);
      totalHaber = totalHaber.plus(haber);
      const diff = debe.minus(haber);

      return {
        cuentaCodigo:  r.codigo,
        cuentaNombre:  r.nombre,
        tipoCuenta:    r.tipo,
        totalDebe:     debe.toFixed(4),
        totalHaber:    haber.toFixed(4),
        saldoDeudor:   diff.gt(0) ? diff.toFixed(4) : '0.0000',
        saldoAcreedor: diff.lt(0) ? diff.abs().toFixed(4) : '0.0000',
      };
    });

    return {
      empresaId,
      periodo: { desde: opts.fechaDesde, hasta: opts.fechaHasta },
      lineas,
      totalDebe:  totalDebe.toFixed(4),
      totalHaber: totalHaber.toFixed(4),
      cuadra:     totalDebe.minus(totalHaber).abs().lt('0.0001'),
    };
  }

  /**
   * Detalle de un asiento con trazabilidad P8:
   * navega desde las líneas hasta el evento operativo origen.
   */
  async detalleAsiento(empresaId: string, asientoId: string): Promise<DetalleAsiento> {
    const [asiento] = await this.dbService.tx
      .select()
      .from(asientosContables)
      .where(and(
        eq(asientosContables.id, asientoId),
        eq(asientosContables.empresaId, empresaId),
      ))
      .limit(1);

    if (!asiento) throw new NotFoundException(`Asiento ${asientoId} no encontrado.`);

    const lineas = await this.dbService.tx
      .select({
        tipo: lineasAsiento.tipo,
        importe: lineasAsiento.importe,
        moneda: lineasAsiento.moneda,
        cuentaCodigo: cuentasContables.codigo,
        cuentaNombre: cuentasContables.nombre,
      })
      .from(lineasAsiento)
      .innerJoin(cuentasContables, eq(cuentasContables.id, lineasAsiento.cuentaId))
      .where(eq(lineasAsiento.asientoId, asientoId));

    let totalDebe = new Decimal(0);
    let totalHaber = new Decimal(0);
    const lineasDto: LineaLibroDiario[] = lineas.map((l) => {
      const imp = new Decimal(l.importe);
      if (l.tipo === 'debe') totalDebe = totalDebe.plus(imp);
      else totalHaber = totalHaber.plus(imp);
      return { cuentaCodigo: l.cuentaCodigo, cuentaNombre: l.cuentaNombre, tipo: l.tipo as 'debe' | 'haber', importe: l.importe, moneda: l.moneda };
    });

    let eventoOrigen: DetalleAsiento['eventoOrigen'] = null;
    if (asiento.eventoId) {
      const [ev] = await this.dbService.tx
        .select({
          tipoEvento: eventosOperativos.tipoEvento,
          ocurridoEn: eventosOperativos.ocurridoEn,
          usuarioId: eventosOperativos.usuarioId,
          proyectoId: eventosOperativos.proyectoId,
          centroCostoId: eventosOperativos.centroCostoId,
        })
        .from(eventosOperativos)
        .where(eq(eventosOperativos.id, asiento.eventoId))
        .limit(1);
      if (ev) eventoOrigen = ev;
    }

    return {
      id: asiento.id,
      numero: asiento.numero,
      fecha: asiento.fecha,
      tipo: asiento.tipo,
      estado: asiento.estado,
      descripcion: asiento.descripcion,
      aprobadoPor: asiento.aprobadoPor,
      eventoId: asiento.eventoId,
      reglaId: asiento.reglaId,
      eventoOrigen,
      lineas: lineasDto,
      totalDebe: totalDebe.toFixed(4),
      totalHaber: totalHaber.toFixed(4),
    };
  }
}
