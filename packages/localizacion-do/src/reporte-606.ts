import Decimal from 'decimal.js';
import type { DatosFila606, PeriodoFiscal, Reporte606 } from './reporte-dgii.types.js';

/** Genera el Reporte 606 (Compras) a partir de las filas ya consultadas en BD. */
export function generarReporte606(
  rncEmpresa: string,
  periodo: PeriodoFiscal,
  filas: DatosFila606[],
): Reporte606 {
  let totalMonto = new Decimal(0);
  let totalItbis = new Decimal(0);
  let totalItbisRet = new Decimal(0);
  let totalIsrRet = new Decimal(0);

  for (const f of filas) {
    totalMonto = totalMonto.plus(f.montoSubtotal);
    totalItbis = totalItbis.plus(f.montoItbis);
    totalItbisRet = totalItbisRet.plus(f.itbisRetenido);
    totalIsrRet = totalIsrRet.plus(f.isrRetenido);
  }

  return {
    rncEmpresa,
    periodo,
    filas,
    totales: {
      facturas: filas.length,
      montoSubtotal: totalMonto.toFixed(4),
      montoItbis: totalItbis.toFixed(4),
      itbisRetenido: totalItbisRet.toFixed(4),
      isrRetenido: totalIsrRet.toFixed(4),
    },
  };
}
