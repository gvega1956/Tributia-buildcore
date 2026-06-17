import Decimal from 'decimal.js';
import type { DatosFila607, PeriodoFiscal, Reporte607 } from './reporte-dgii.types.js';

/** Genera el Reporte 607 (Ventas) a partir de los e-CF aceptados del período. */
export function generarReporte607(
  rncEmpresa: string,
  periodo: PeriodoFiscal,
  filas: DatosFila607[],
): Reporte607 {
  let totalMonto = new Decimal(0);
  let totalItbis = new Decimal(0);
  let totalItbisRet = new Decimal(0);
  let totalIsrRet = new Decimal(0);

  for (const f of filas) {
    totalMonto = totalMonto.plus(f.montoSubtotal);
    totalItbis = totalItbis.plus(f.montoItbis);
    totalItbisRet = totalItbisRet.plus(f.itbisRetenidoPorCliente);
    totalIsrRet = totalIsrRet.plus(f.isrRetenidoPorCliente);
  }

  return {
    rncEmpresa,
    periodo,
    filas,
    totales: {
      comprobantes: filas.length,
      montoSubtotal: totalMonto.toFixed(4),
      montoItbis: totalItbis.toFixed(4),
      itbisRetenidoPorClientes: totalItbisRet.toFixed(4),
      isrRetenidoPorClientes: totalIsrRet.toFixed(4),
    },
  };
}
