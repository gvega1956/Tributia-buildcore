import type { DatosFila608, PeriodoFiscal, Reporte608 } from './reporte-dgii.types.js';

/** Genera el Reporte 608 (Comprobantes anulados) del período. */
export function generarReporte608(
  rncEmpresa: string,
  periodo: PeriodoFiscal,
  filas: DatosFila608[],
): Reporte608 {
  return {
    rncEmpresa,
    periodo,
    filas,
    totales: { anulados: filas.length },
  };
}
