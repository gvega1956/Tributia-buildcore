import Decimal from 'decimal.js';
import type { DatosFila623, PeriodoFiscal, Reporte623 } from './reporte-dgii.types.js';

/** Genera el Reporte 623 (retenciones del Estado a nuestros e-CF de venta). */
export function generarReporte623(
  rncEmpresa: string,
  periodo: PeriodoFiscal,
  filas: DatosFila623[],
): Reporte623 {
  let totalItbis = new Decimal(0);
  let totalIsr = new Decimal(0);

  for (const f of filas) {
    totalItbis = totalItbis.plus(f.itbisRetenido);
    totalIsr = totalIsr.plus(f.isrRetenido);
  }

  const totalRetenido = totalItbis.plus(totalIsr);

  return {
    rncEmpresa,
    periodo,
    filas,
    totales: {
      documentos: filas.length,
      itbisRetenido: totalItbis.toFixed(4),
      isrRetenido: totalIsr.toFixed(4),
      totalRetenido: totalRetenido.toFixed(4),
    },
  };
}
