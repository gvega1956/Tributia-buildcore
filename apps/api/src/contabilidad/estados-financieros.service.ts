import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { DbService } from '../database/db.service.js';

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface PartidaBalance {
  codigo: string;
  nombre: string;
  tipoCuenta: string;
  saldo: string;
}

export interface BalanceGeneral {
  empresaId: string;
  fechaCorte: string;
  activos: { lineas: PartidaBalance[]; total: string };
  pasivos: { lineas: PartidaBalance[]; total: string };
  patrimonio: { lineas: PartidaBalance[]; total: string };
  totalPasivoPatrimonio: string;
  cuadra: boolean;
}

export interface PartidaResultados {
  codigo: string;
  nombre: string;
  tipoCuenta: string;
  monto: string;
  proyectoId: string | null;
}

export interface EstadoResultados {
  empresaId: string;
  periodo: { desde: string; hasta: string };
  proyectoId: string | null;
  ingresos: { lineas: PartidaResultados[]; total: string };
  costos: { lineas: PartidaResultados[]; total: string };
  gastos: { lineas: PartidaResultados[]; total: string };
  utilidadBruta: string;
  utilidadNeta: string;
}

// ─── Servicio ────────────────────────────────────────────────────────────────

@Injectable()
export class EstadosFinancierosService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Balance General al corte de una fecha.
   *
   * Acumula TODOS los asientos históricos hasta `fechaCorte` para las cuentas
   * de tipo activo, pasivo y patrimonio. Las cuentas de resultado (ingreso,
   * costo, gasto) no aparecen aquí — su saldo neto forma parte del patrimonio
   * a través del asiento de cierre de resultados.
   *
   * Invariante: totalActivos === totalPasivos + totalPatrimonio
   */
  async balanceGeneral(empresaId: string, fechaCorte: string): Promise<BalanceGeneral> {
    const result = await this.dbService.tx.execute(sql`
      SELECT
        cc.codigo,
        cc.nombre,
        cc.tipo,
        cc.naturaleza,
        COALESCE(SUM(la.importe::numeric * CASE WHEN la.tipo = 'debe' THEN 1 ELSE -1 END), 0)::text AS saldo_neto
      FROM cuenta_contable cc
      LEFT JOIN (
        SELECT la2.*
        FROM linea_asiento la2
        JOIN asiento_contable ac2 ON ac2.id = la2.asiento_id
        WHERE ac2.empresa_id = ${empresaId}
          AND ac2.fecha <= ${fechaCorte}::date
      ) la ON la.cuenta_id = cc.id
      WHERE cc.empresa_id = ${empresaId}
        AND cc.activo = true
        AND cc.es_movimiento = true
        AND cc.tipo IN ('activo','pasivo','patrimonio')
      GROUP BY cc.codigo, cc.nombre, cc.tipo, cc.naturaleza
      ORDER BY cc.codigo
    `);

    type Row = { codigo: string; nombre: string; tipo: string; naturaleza: string; saldo_neto: string };
    let totalActivos = new Decimal(0);
    let totalPasivos = new Decimal(0);
    let totalPatrimonio = new Decimal(0);

    const activos: PartidaBalance[] = [];
    const pasivos: PartidaBalance[] = [];
    const patrimonio: PartidaBalance[] = [];

    for (const r of result.rows as Row[]) {
      // saldo_neto = Σdebe - Σhaber (positivo = saldo deudor)
      // Para activos (naturaleza deudora): saldo > 0 es normal
      // Para pasivos/patrimonio (naturaleza acreedora): saldo < 0 es normal
      const saldoNeto = new Decimal(r.saldo_neto);

      // Convertir a saldo "positivo normal" según naturaleza
      const saldo = r.naturaleza === 'acreedora' ? saldoNeto.neg() : saldoNeto;
      const partida: PartidaBalance = { codigo: r.codigo, nombre: r.nombre, tipoCuenta: r.tipo, saldo: saldo.toFixed(4) };

      if (r.tipo === 'activo') { totalActivos = totalActivos.plus(saldo); activos.push(partida); }
      else if (r.tipo === 'pasivo') { totalPasivos = totalPasivos.plus(saldo); pasivos.push(partida); }
      else { totalPatrimonio = totalPatrimonio.plus(saldo); patrimonio.push(partida); }
    }

    const totalPP = totalPasivos.plus(totalPatrimonio);

    return {
      empresaId,
      fechaCorte,
      activos:    { lineas: activos, total: totalActivos.toFixed(4) },
      pasivos:    { lineas: pasivos, total: totalPasivos.toFixed(4) },
      patrimonio: { lineas: patrimonio, total: totalPatrimonio.toFixed(4) },
      totalPasivoPatrimonio: totalPP.toFixed(4),
      cuadra: totalActivos.minus(totalPP).abs().lt('0.0001'),
    };
  }

  /**
   * Estado de Resultados para un período.
   *
   * Suma los asientos de cuentas ingreso, costo y gasto dentro del período.
   * Con desglose por proyecto cuando se enlaza via evento_operativo.
   *
   * Si proyectoId se proporciona, filtra solo los asientos ligados a ese proyecto.
   * Las cuentas de ingreso tienen saldo acreedor (haber > debe) y las de
   * costo/gasto tienen saldo deudor (debe > haber).
   */
  async estadoResultados(
    empresaId: string,
    opts: { fechaDesde: string; fechaHasta: string; proyectoId?: string },
  ): Promise<EstadoResultados> {
    const proyectoFiltro = opts.proyectoId ?? null;

    const result = await this.dbService.tx.execute(sql`
      SELECT
        cc.codigo,
        cc.nombre,
        cc.tipo,
        eo.proyecto_id,
        COALESCE(SUM(la.importe::numeric * CASE WHEN la.tipo = 'haber' THEN 1 ELSE -1 END), 0)::text AS saldo_neto
      FROM cuenta_contable cc
      JOIN linea_asiento la ON la.cuenta_id = cc.id
      JOIN asiento_contable ac ON ac.id = la.asiento_id
      LEFT JOIN evento_operativo eo ON eo.id = ac.evento_id
      WHERE cc.empresa_id = ${empresaId}
        AND cc.activo = true
        AND cc.es_movimiento = true
        AND cc.tipo IN ('ingreso','costo','gasto')
        AND ac.fecha BETWEEN ${opts.fechaDesde}::date AND ${opts.fechaHasta}::date
        AND (${proyectoFiltro}::uuid IS NULL OR eo.proyecto_id = ${proyectoFiltro}::uuid)
      GROUP BY cc.codigo, cc.nombre, cc.tipo, eo.proyecto_id
      ORDER BY cc.tipo, cc.codigo
    `);

    type Row = { codigo: string; nombre: string; tipo: string; proyecto_id: string | null; saldo_neto: string };
    let totalIngresos = new Decimal(0);
    let totalCostos  = new Decimal(0);
    let totalGastos  = new Decimal(0);

    const ingresosLineas: PartidaResultados[] = [];
    const costosLineas:   PartidaResultados[] = [];
    const gastosLineas:   PartidaResultados[] = [];

    for (const r of result.rows as Row[]) {
      // saldo_neto = Σhaber - Σdebe (para ingresos positivo = ganancia)
      const saldo = new Decimal(r.saldo_neto);

      const partida: PartidaResultados = {
        codigo: r.codigo, nombre: r.nombre, tipoCuenta: r.tipo,
        monto: saldo.abs().toFixed(4),
        proyectoId: r.proyecto_id,
      };

      if (r.tipo === 'ingreso') { totalIngresos = totalIngresos.plus(saldo.abs()); ingresosLineas.push(partida); }
      else if (r.tipo === 'costo') { totalCostos = totalCostos.plus(saldo.abs()); costosLineas.push(partida); }
      else { totalGastos = totalGastos.plus(saldo.abs()); gastosLineas.push(partida); }
    }

    const utilidadBruta = totalIngresos.minus(totalCostos);
    const utilidadNeta  = utilidadBruta.minus(totalGastos);

    return {
      empresaId,
      periodo:       { desde: opts.fechaDesde, hasta: opts.fechaHasta },
      proyectoId:    opts.proyectoId ?? null,
      ingresos:      { lineas: ingresosLineas, total: totalIngresos.toFixed(4) },
      costos:        { lineas: costosLineas,   total: totalCostos.toFixed(4) },
      gastos:        { lineas: gastosLineas,   total: totalGastos.toFixed(4) },
      utilidadBruta: utilidadBruta.toFixed(4),
      utilidadNeta:  utilidadNeta.toFixed(4),
    };
  }
}
