/**
 * PdfRenderService — motor de renderizado pdfkit.
 *
 * Elegido pdfkit (vs puppeteer) porque:
 *  - Sin dependencia de Chromium: CI y Docker se mantienen ligeros.
 *  - Generación síncrona en Buffer sin spin-up de browser (< 100 ms).
 *  - Control total del layout: encabezado, tablas, totales y pie de página.
 */
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit');
import Decimal from 'decimal.js';

// ── Tipos de datos de entrada para cada plantilla ────────────────────────────

export interface EmisorPdf {
  nombre: string;
  rnc: string | null;
  direccion?: string | null;
}

export interface TerceroPdf {
  nombreComercial: string;
  rncCedula: string;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
}

export interface LineaOcPdf {
  descripcion: string;
  cantidad: string;
  unidadMedida: string;
  precioUnitario: string;
  total: string;
}

export interface OrdenCompraPdfData {
  emisor: EmisorPdf;
  proveedor: TerceroPdf;
  numero: string;
  estado: string;
  fechaEmision: string | null;
  fechaEntregaPrometida: string | null;
  condicionesPago: string | null;
  moneda: string;
  totalMonto: string;
  lineas: LineaOcPdf[];
}

export interface LineaCubicacionPdf {
  partida: string;
  cantidadAnterior: string;
  cantidadPeriodo: string;
  cantidadAcumulada: string;
  precioUnitario: string;
  monto: string;
}

export interface CubicacionPdfData {
  emisor: EmisorPdf;
  cliente: TerceroPdf;
  proyectoNombre: string;
  numeroContrato: string | null;
  numero: number;
  fechaCorte: string;
  moneda: string;
  montoBruto: string;
  montoRetencionGarantia: string;
  retencionGarantiaPct: string | null;
  montoFacturable: string;
  lineas: LineaCubicacionPdf[];
}

export interface FacturaClientePdfData {
  emisor: EmisorPdf;
  cliente: TerceroPdf;
  proyectoNombre: string;
  numero: string;
  ncf: string | null;
  fechaEmision: string;
  moneda: string;
  montoSubtotal: string;
  montoItbis: string;
  montoRetencionIsr: string;
  montoRetencionItbis: string;
  montoTotal: string;
  montoNetoACobrar: string;
  lineas: LineaCubicacionPdf[];
}

// ── Constantes de layout ──────────────────────────────────────────────────────

const MARGIN   = 50;
const PAGE_W   = 612; // Letter
const BODY_W   = PAGE_W - MARGIN * 2;
const COL_GRAY = '#64748b';
const COL_DARK = '#0f172a';
const COL_BRAND = '#3b82f6';

// ── Utilidades compartidas ────────────────────────────────────────────────────

function fmtMoney(val: string, decimals = 2): string {
  return new Intl.NumberFormat('es-DO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(parseFloat(val));
}

function fmtDate(val: string | null): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return val;
  }
}

interface TableOptions {
  headers: { label: string; width: number; align?: 'left' | 'right' | 'center' }[];
  rows: string[][];
  x: number;
  y: number;
  rowH?: number;
}

/** Dibuja una tabla y devuelve la Y final. */
function drawTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  opts: TableOptions,
): number {
  const { headers, rows, x, y, rowH = 18 } = opts;
  const totalW = headers.reduce((s, h) => s + h.width, 0);
  let curY = y;

  // Fila de encabezado
  doc.fillColor(COL_DARK).rect(x, curY, totalW, rowH + 2).fill();
  let cx = x;
  for (const h of headers) {
    doc.fillColor('white').font('Helvetica-Bold').fontSize(7)
      .text(h.label, cx + 4, curY + 5, { width: h.width - 8, align: h.align ?? 'left', lineBreak: false });
    cx += h.width;
  }
  curY += rowH + 2;

  // Filas de datos
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const bg = i % 2 === 0 ? '#f8fafc' : 'white';
    doc.fillColor(bg).rect(x, curY, totalW, rowH).fill();
    // Borde inferior
    doc.strokeColor('#e2e8f0').lineWidth(0.4)
      .moveTo(x, curY + rowH).lineTo(x + totalW, curY + rowH).stroke();

    cx = x;
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j]!;
      doc.fillColor('#334155').font('Helvetica').fontSize(7)
        .text(row[j] ?? '', cx + 4, curY + 5, { width: h.width - 8, align: h.align ?? 'left', lineBreak: false });
      cx += h.width;
    }
    curY += rowH;
  }

  // Borde exterior
  doc.strokeColor('#cbd5e1').lineWidth(0.5)
    .rect(x, y, totalW, curY - y).stroke();

  return curY;
}

/** Dibuja el encabezado con datos del emisor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawHeader(doc: any, emisor: EmisorPdf, titulo: string, subtitulo: string): void {
  // Línea brand superior
  doc.fillColor(COL_BRAND).rect(MARGIN, 35, BODY_W, 4).fill();

  // Nombre empresa (grande)
  doc.fillColor(COL_DARK).font('Helvetica-Bold').fontSize(14)
    .text(emisor.nombre, MARGIN, 50, { width: BODY_W * 0.55, lineBreak: false });

  if (emisor.rnc) {
    doc.fillColor(COL_GRAY).font('Helvetica').fontSize(8)
      .text(`RNC: ${emisor.rnc}`, MARGIN, 67);
  }
  if (emisor.direccion) {
    doc.fillColor(COL_GRAY).font('Helvetica').fontSize(8)
      .text(emisor.direccion, MARGIN, emisor.rnc ? 78 : 67, { width: BODY_W * 0.55 });
  }

  // Título del documento (derecha)
  const rightX = MARGIN + BODY_W * 0.6;
  doc.fillColor(COL_BRAND).font('Helvetica-Bold').fontSize(18)
    .text(titulo, rightX, 48, { width: BODY_W * 0.4, align: 'right' });
  doc.fillColor(COL_GRAY).font('Helvetica').fontSize(9)
    .text(subtitulo, rightX, 70, { width: BODY_W * 0.4, align: 'right' });

  // Línea separadora
  doc.strokeColor('#e2e8f0').lineWidth(1)
    .moveTo(MARGIN, 100).lineTo(MARGIN + BODY_W, 100).stroke();
}

/** Dibuja el pie de página. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawFooter(doc: any, generadoEl: string): void {
  const footerY = 760;
  doc.strokeColor('#e2e8f0').lineWidth(0.5)
    .moveTo(MARGIN, footerY).lineTo(MARGIN + BODY_W, footerY).stroke();
  doc.fillColor(COL_GRAY).font('Helvetica').fontSize(7)
    .text(`Generado el ${generadoEl} · Tributia BuildCore`, MARGIN, footerY + 5, { width: BODY_W });
}

/** Dibuja un bloque de dos columnas de metadatos. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawMetaGrid(doc: any, y: number, campos: [string, string][]) {
  const colW = BODY_W / 2 - 6;
  for (let i = 0; i < campos.length; i++) {
    const [label, value] = campos[i]!;
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * (colW + 12);
    const fy = y + row * 22;
    doc.fillColor(COL_GRAY).font('Helvetica').fontSize(7).text(label.toUpperCase(), x, fy, { lineBreak: false });
    doc.fillColor(COL_DARK).font('Helvetica-Bold').fontSize(8).text(value, x, fy + 9, { lineBreak: false });
  }
  return y + Math.ceil(campos.length / 2) * 22;
}

/** Sección de totales alineada a la derecha. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawTotals(doc: any, y: number, filas: [string, string][], moneda: string) {
  const labelW = 130;
  const valueW = 90;
  const x = MARGIN + BODY_W - labelW - valueW;
  let cy = y + 8;

  for (let i = 0; i < filas.length; i++) {
    const [label, value] = filas[i]!;
    const isLast = i === filas.length - 1;
    if (isLast) {
      doc.fillColor(COL_DARK).rect(x - 6, cy - 3, labelW + valueW + 12, 20).fill();
      doc.fillColor('white').font('Helvetica-Bold').fontSize(9)
        .text(label, x, cy + 1, { width: labelW, align: 'right', lineBreak: false })
        .text(`${moneda} ${value}`, x + labelW, cy + 1, { width: valueW, align: 'right', lineBreak: false });
    } else {
      doc.fillColor(COL_GRAY).font('Helvetica').fontSize(8)
        .text(label, x, cy, { width: labelW, align: 'right', lineBreak: false });
      doc.fillColor(COL_DARK).font('Helvetica').fontSize(8)
        .text(`${moneda} ${value}`, x + labelW, cy, { width: valueW, align: 'right', lineBreak: false });
    }
    cy += isLast ? 22 : 16;
  }
  return cy;
}

// ── Servicio ──────────────────────────────────────────────────────────────────

@Injectable()
export class PdfRenderService {

  private toBuffer(draw: (doc: InstanceType<typeof PDFDocument>) => void): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margins: { top: 35, bottom: 40, left: MARGIN, right: MARGIN } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try { draw(doc); } catch (err) { reject(err); return; }
      doc.end();
    });
  }

  // ── Plantilla: Orden de Compra ──────────────────────────────────────────────

  async renderOrdenCompra(data: OrdenCompraPdfData): Promise<Buffer> {
    return this.toBuffer((doc) => {
      const generadoEl = new Date().toLocaleString('es-DO');
      drawHeader(doc, data.emisor, 'ORDEN DE COMPRA', `No. ${data.numero}`);

      let y = 115;

      // Datos del proveedor y la OC
      y = drawMetaGrid(doc, y, [
        ['Proveedor', data.proveedor.nombreComercial],
        ['RNC / Cédula', data.proveedor.rncCedula],
        ['Estado', data.estado],
        ['Moneda', data.moneda],
        ['Fecha emisión', fmtDate(data.fechaEmision)],
        ['Entrega prometida', fmtDate(data.fechaEntregaPrometida)],
        ['Condiciones de pago', data.condicionesPago ?? '—'],
        ...(data.proveedor.telefono ? [['Teléfono', data.proveedor.telefono] as [string, string]] : []),
      ]);

      y += 14;
      doc.fillColor(COL_GRAY).font('Helvetica-Bold').fontSize(8)
        .text('DETALLE DE LÍNEAS', MARGIN, y);
      y += 12;

      // Tabla de líneas
      const headers = [
        { label: 'Descripción',    width: 220 },
        { label: 'Cantidad',       width: 60,  align: 'right' as const },
        { label: 'U/M',            width: 45 },
        { label: 'Precio unitario',width: 90,  align: 'right' as const },
        { label: 'Total',          width: 97,  align: 'right' as const },
      ];
      const rows = data.lineas.map((l) => [
        l.descripcion,
        fmtMoney(l.cantidad, 2),
        l.unidadMedida,
        fmtMoney(l.precioUnitario),
        fmtMoney(l.total),
      ]);
      y = drawTable(doc, { headers, rows, x: MARGIN, y });

      // Totales
      y = drawTotals(doc, y + 6, [
        ['TOTAL', fmtMoney(data.totalMonto)],
      ], data.moneda);

      drawFooter(doc, generadoEl);
    });
  }

  // ── Plantilla: Cubicación ───────────────────────────────────────────────────

  async renderCubicacion(data: CubicacionPdfData): Promise<Buffer> {
    return this.toBuffer((doc) => {
      const generadoEl = new Date().toLocaleString('es-DO');
      drawHeader(doc, data.emisor, 'CUBICACIÓN', `No. ${data.numero}`);

      let y = 115;

      y = drawMetaGrid(doc, y, [
        ['Proyecto', data.proyectoNombre],
        ['Cliente', data.cliente.nombreComercial],
        ['No. contrato', data.numeroContrato ?? '—'],
        ['RNC cliente', data.cliente.rncCedula],
        ['Fecha de corte', fmtDate(data.fechaCorte)],
        ['Moneda', data.moneda],
      ]);

      y += 14;
      doc.fillColor(COL_GRAY).font('Helvetica-Bold').fontSize(8)
        .text('PARTIDAS CERTIFICADAS', MARGIN, y);
      y += 12;

      const headers = [
        { label: 'Partida',           width: 180 },
        { label: 'Cant. anterior',    width: 70, align: 'right' as const },
        { label: 'Cant. período',     width: 70, align: 'right' as const },
        { label: 'Cant. acumulada',   width: 70, align: 'right' as const },
        { label: 'Precio U.',         width: 75, align: 'right' as const },
        { label: 'Monto',             width: 47, align: 'right' as const },
      ];
      const rows = data.lineas.map((l) => [
        l.partida,
        fmtMoney(l.cantidadAnterior, 2),
        fmtMoney(l.cantidadPeriodo, 2),
        fmtMoney(l.cantidadAcumulada, 2),
        fmtMoney(l.precioUnitario),
        fmtMoney(l.monto),
      ]);
      y = drawTable(doc, { headers, rows, x: MARGIN, y });

      const retPct = data.retencionGarantiaPct
        ? `${data.retencionGarantiaPct}%`
        : '0%';

      y = drawTotals(doc, y + 6, [
        ['Subtotal bruto', fmtMoney(data.montoBruto)],
        [`Retención garantía (${retPct})`, `(${fmtMoney(data.montoRetencionGarantia)})`],
        ['TOTAL A FACTURAR', fmtMoney(data.montoFacturable)],
      ], data.moneda);

      drawFooter(doc, generadoEl);
    });
  }

  // ── Plantilla: Factura de Cliente ───────────────────────────────────────────

  async renderFacturaCliente(data: FacturaClientePdfData): Promise<Buffer> {
    return this.toBuffer((doc) => {
      const generadoEl = new Date().toLocaleString('es-DO');
      drawHeader(doc, data.emisor, 'FACTURA', `No. ${data.numero}`);

      let y = 115;

      y = drawMetaGrid(doc, y, [
        ['Cliente', data.cliente.nombreComercial],
        ['RNC / Cédula', data.cliente.rncCedula],
        ['Proyecto', data.proyectoNombre],
        ['Fecha emisión', fmtDate(data.fechaEmision)],
        ['NCF', data.ncf ?? 'Pendiente e-CF'],
        ['Moneda', data.moneda],
        ...(data.cliente.email ? [['Email', data.cliente.email] as [string, string]] : []),
        ...(data.cliente.telefono ? [['Teléfono', data.cliente.telefono] as [string, string]] : []),
      ]);

      y += 14;
      doc.fillColor(COL_GRAY).font('Helvetica-Bold').fontSize(8)
        .text('DETALLE (Certificación de avance)', MARGIN, y);
      y += 12;

      const headers = [
        { label: 'Partida',         width: 180 },
        { label: 'Cant. período',   width: 80, align: 'right' as const },
        { label: 'Precio U.',       width: 80, align: 'right' as const },
        { label: 'Monto',           width: 80, align: 'right' as const },
        { label: 'Moneda',          width: 92 },
      ];
      const rows = data.lineas.map((l) => [
        l.partida,
        fmtMoney(l.cantidadPeriodo, 2),
        fmtMoney(l.precioUnitario),
        fmtMoney(l.monto),
        data.moneda,
      ]);
      y = drawTable(doc, { headers, rows, x: MARGIN, y });

      const hasRetenciones =
        new Decimal(data.montoRetencionIsr).gt(0) ||
        new Decimal(data.montoRetencionItbis).gt(0);

      const totalsFila: [string, string][] = [
        ['Subtotal', fmtMoney(data.montoSubtotal)],
        [`ITBIS (18%)`, fmtMoney(data.montoItbis)],
        ['Total', fmtMoney(data.montoTotal)],
      ];
      if (hasRetenciones) {
        if (new Decimal(data.montoRetencionIsr).gt(0)) {
          totalsFila.push(['Retención ISR', `(${fmtMoney(data.montoRetencionIsr)})`]);
        }
        if (new Decimal(data.montoRetencionItbis).gt(0)) {
          totalsFila.push(['Retención ITBIS', `(${fmtMoney(data.montoRetencionItbis)})`]);
        }
      }
      totalsFila.push(['NETO A COBRAR', fmtMoney(data.montoNetoACobrar)]);

      drawTotals(doc, y + 6, totalsFila, data.moneda);
      drawFooter(doc, generadoEl);
    });
  }
}
