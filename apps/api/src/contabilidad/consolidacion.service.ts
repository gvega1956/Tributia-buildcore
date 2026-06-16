import { Injectable } from '@nestjs/common';
import { eq, and, inArray, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { cuentasContables } from '../db/schema/contabilidad/cuenta_contable.js';
import { lineasAsiento } from '../db/schema/contabilidad/linea_asiento.js';
import { asientosContables } from '../db/schema/contabilidad/asiento_contable.js';
import type { DbTx } from '../ledger/projection.types.js';

export interface SaldoEmpresa {
  empresaId: string;
  tipoCuenta: string;
  totalDebe: string;
  totalHaber: string;
  saldoNeto: string;
}

export interface ResultadoConsolidacion {
  empresas: SaldoEmpresa[];
  totalDebe: string;
  totalHaber: string;
  diferencia: string;
}

@Injectable()
export class ConsolidacionService {
  /**
   * Consolida el balance de múltiples empresas del mismo tenant.
   *
   * Retorna:
   *   - Desglose por empresa y tipo de cuenta
   *   - Totales consolidados (Σdebe, Σhaber)
   *   - Diferencia (debe = 0 si las cuentas balancean)
   *
   * Solo incluye empresas que pertenezcan al tenantId dado (RLS extra en código).
   */
  async consolidar(
    tx: DbTx,
    tenantId: string,
    empresaIds: string[],
  ): Promise<ResultadoConsolidacion> {
    if (empresaIds.length === 0) {
      return { empresas: [], totalDebe: '0.0000', totalHaber: '0.0000', diferencia: '0.0000' };
    }

    const rows = await tx
      .select({
        empresaId: cuentasContables.empresaId,
        tipoCuenta: cuentasContables.tipo,
        totalDebe: sql<string>`COALESCE(SUM(CASE WHEN ${lineasAsiento.tipo} = 'debe' THEN ${lineasAsiento.importe}::numeric ELSE 0 END), 0)::text`,
        totalHaber: sql<string>`COALESCE(SUM(CASE WHEN ${lineasAsiento.tipo} = 'haber' THEN ${lineasAsiento.importe}::numeric ELSE 0 END), 0)::text`,
      })
      .from(cuentasContables)
      .innerJoin(lineasAsiento, eq(lineasAsiento.cuentaId, cuentasContables.id))
      .innerJoin(asientosContables, eq(asientosContables.id, lineasAsiento.asientoId))
      .where(and(
        eq(cuentasContables.tenantId, tenantId),
        inArray(cuentasContables.empresaId, empresaIds),
      ))
      .groupBy(cuentasContables.empresaId, cuentasContables.tipo);

    let totalDebe = new Decimal(0);
    let totalHaber = new Decimal(0);

    const empresas: SaldoEmpresa[] = rows.map((r) => {
      const debe = new Decimal(r.totalDebe);
      const haber = new Decimal(r.totalHaber);
      totalDebe = totalDebe.plus(debe);
      totalHaber = totalHaber.plus(haber);

      return {
        empresaId: r.empresaId,
        tipoCuenta: r.tipoCuenta,
        totalDebe: debe.toFixed(4),
        totalHaber: haber.toFixed(4),
        saldoNeto: haber.minus(debe).toFixed(4),
      };
    });

    return {
      empresas,
      totalDebe: totalDebe.toFixed(4),
      totalHaber: totalHaber.toFixed(4),
      diferencia: totalDebe.minus(totalHaber).abs().toFixed(4),
    };
  }
}
