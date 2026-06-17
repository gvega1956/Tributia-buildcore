/**
 * Exportadores DGII — convierten los reportes a formato TXT pipe-delimited
 * según las especificaciones de la DGII (Norma General 06-2018 y posteriores).
 *
 * Formato general: cabecera + N filas de datos, separadas por '\n'.
 * Cada campo separado por '|'. Campos vacíos = cadena vacía entre pipes.
 * Fechas en formato AAAAMMDD.
 * Montos con 2 decimales (DGII usa 2 decimales en los archivos TXT).
 */
import type { Reporte606, Reporte607, Reporte608, Reporte623 } from './reporte-dgii.types.js';

function fmt2(monto: string): string {
  const n = parseFloat(monto);
  return isNaN(n) ? '0.00' : n.toFixed(2);
}

function fmtFecha(fecha: string | undefined): string {
  if (!fecha) return '';
  return fecha.replace(/-/g, '');
}

function fmtPeriodo(anio: number, mes: number): string {
  return `${anio}${mes.toString().padStart(2, '0')}`;
}

/**
 * Exporta el Reporte 606 al formato TXT DGII.
 *
 * Columnas (13 principales):
 * RNC|TipoID|TipoBienServicio|NCF|NCFMod|FechaComprobante|FechaPago|
 * MontoServicios|MontoBienes|MontoFacturado|ITBISFact|ITBISRet|ISRRet
 */
export function exportar606Txt(r: Reporte606): string {
  const lines: string[] = [];
  lines.push(`${r.rncEmpresa}|${fmtPeriodo(r.periodo.anio, r.periodo.mes)}|${r.totales.facturas}`);

  for (const f of r.filas) {
    const montoServ = f.tipoBienServicio === 'S' || f.tipoBienServicio === 'BS' ? fmt2(f.montoSubtotal) : '0.00';
    const montoBien = f.tipoBienServicio === 'B' || f.tipoBienServicio === 'BS' ? fmt2(f.montoSubtotal) : '0.00';
    const tipoNum = f.tipoBienServicio === 'B' ? '1' : f.tipoBienServicio === 'S' ? '2' : '3';

    lines.push([
      f.rncCedula,
      f.tipoIdentificacion,
      tipoNum,
      f.ncf,
      f.ncfModificado ?? '',
      fmtFecha(f.fechaComprobante),
      fmtFecha(f.fechaPago),
      montoServ,
      montoBien,
      fmt2(f.montoSubtotal),
      fmt2(f.montoItbis),
      fmt2(f.itbisRetenido),
      fmt2(f.isrRetenido),
    ].join('|'));
  }

  return lines.join('\n');
}

/**
 * Exporta el Reporte 607 al formato TXT DGII.
 *
 * Columnas (8 principales):
 * RNC|TipoID|NCF|NCFMod|FechaComprobante|MontoFacturado|ITBISFact|ITBISRet|ISRRet
 */
export function exportar607Txt(r: Reporte607): string {
  const lines: string[] = [];
  lines.push(`${r.rncEmpresa}|${fmtPeriodo(r.periodo.anio, r.periodo.mes)}|${r.totales.comprobantes}`);

  for (const f of r.filas) {
    lines.push([
      f.rncCedula,
      f.tipoIdentificacion,
      f.ncf,
      f.ncfModificado ?? '',
      fmtFecha(f.fechaComprobante),
      fmt2(f.montoSubtotal),
      fmt2(f.montoItbis),
      fmt2(f.itbisRetenidoPorCliente),
      fmt2(f.isrRetenidoPorCliente),
    ].join('|'));
  }

  return lines.join('\n');
}

/**
 * Exporta el Reporte 608 al formato TXT DGII.
 *
 * Columnas: TipoComprobante|NCF|FechaEmision
 */
export function exportar608Txt(r: Reporte608): string {
  const lines: string[] = [];
  lines.push(`${r.rncEmpresa}|${fmtPeriodo(r.periodo.anio, r.periodo.mes)}|${r.totales.anulados}`);

  for (const f of r.filas) {
    lines.push([
      f.tipoComprobante,
      f.ncf,
      fmtFecha(f.fechaEmisionOriginal),
    ].join('|'));
  }

  return lines.join('\n');
}

/**
 * Exporta el Reporte 623 al formato TXT DGII.
 *
 * Columnas: RNCRetenedor|NombreRetenedor|NCF|FechaDoc|MontoDoc|ITBISRet|ISRRet|TotalRet
 */
export function exportar623Txt(r: Reporte623): string {
  const lines: string[] = [];
  lines.push(`${r.rncEmpresa}|${fmtPeriodo(r.periodo.anio, r.periodo.mes)}|${r.totales.documentos}`);

  for (const f of r.filas) {
    lines.push([
      f.rncRetenedor,
      f.nombreRetenedor,
      f.ncfDocumento,
      fmtFecha(f.fechaDocumento),
      fmt2(f.montoDocumento),
      fmt2(f.itbisRetenido),
      fmt2(f.isrRetenido),
      fmt2(String(parseFloat(f.itbisRetenido) + parseFloat(f.isrRetenido))),
    ].join('|'));
  }

  return lines.join('\n');
}
