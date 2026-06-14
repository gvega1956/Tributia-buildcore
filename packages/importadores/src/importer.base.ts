import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import type { FilaError, ImportacionResult } from './importer.types.js';

export interface ImportContext {
  tenantId: string;
  usuarioId: string;
  empresaId?: string;
  proyectoId?: string;
}

type CellScalar = string | number | null;

function normalizarCelda(cell: unknown): CellScalar {
  if (cell == null) return null;
  if (typeof cell === 'string') return cell.trim() || null;
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'boolean') return String(cell);
  if (cell instanceof Date) return cell.toISOString().split('T')[0] ?? null;
  // RichText: { richText: { text: string }[] }
  if (typeof cell === 'object' && 'richText' in cell) {
    const rt = cell as { richText: { text: string }[] };
    return rt.richText.map((r) => r.text).join('').trim() || null;
  }
  // Formula result: { formula: string, result: ... }
  if (typeof cell === 'object' && 'result' in cell) {
    const f = cell as { result: CellScalar };
    return normalizarCelda(f.result);
  }
  // Hyperlink: { text: string, hyperlink: string }
  if (typeof cell === 'object' && 'text' in cell) {
    return normalizarCelda((cell as { text: string }).text);
  }
  return String(cell);
}

/**
 * Base genérica para importadores Excel con validación fila a fila, dry-run y
 * reporte de errores descargable.
 *
 * Subclases implementan `columnas`, `validarFila` y `procesarFila`.
 */
export abstract class ImportadorBase<TFila, TResultado = TFila> {
  abstract readonly columnas: string[];

  protected abstract validarFila(
    valores: CellScalar[],
    fila: number,
  ): { ok: true; data: TFila } | { ok: false; errores: FilaError[] };

  protected abstract procesarFila(
    fila: TFila,
    ctx: ImportContext,
  ): Promise<TResultado>;

  async importar(
    buffer: Buffer,
    ctx: ImportContext,
    simulacion = false,
  ): Promise<ImportacionResult<TResultado>> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(Readable.from(buffer));

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('El archivo Excel no contiene hojas de cálculo.');

    // ── Recolectar filas (sync) ────────────────────────────────────────────────
    const rawRows: { rowNumber: number; valores: CellScalar[] }[] = [];

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // fila de encabezados
      const raw = row.values as unknown[];
      // ExcelJS: raw[0] es undefined; celdas comienzan en raw[1]
      const valores: CellScalar[] = [];
      for (let i = 1; i <= this.columnas.length; i++) {
        valores.push(normalizarCelda(raw[i]));
      }
      rawRows.push({ rowNumber, valores });
    });

    // ── Validar ───────────────────────────────────────────────────────────────
    const errores: FilaError[] = [];
    const filasValidas: { rowNumber: number; data: TFila }[] = [];

    for (const { rowNumber, valores } of rawRows) {
      const result = this.validarFila(valores, rowNumber);
      if (!result.ok) {
        errores.push(...result.errores);
      } else {
        filasValidas.push({ rowNumber, data: result.data });
      }
    }

    // ── Procesar (solo si no es simulación) ──────────────────────────────────
    const resultados: TResultado[] = [];
    if (!simulacion) {
      for (const { rowNumber, data } of filasValidas) {
        try {
          const resultado = await this.procesarFila(data, ctx);
          resultados.push(resultado);
        } catch (err) {
          errores.push({
            fila: rowNumber,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const procesadas = simulacion ? filasValidas.length : resultados.length;

    return {
      totalFilas: rawRows.length,
      procesadas,
      omitidas: rawRows.length - procesadas,
      errores,
      simulacion,
      ...(simulacion
        ? { datos: filasValidas.map((f) => f.data) as unknown as TResultado[] }
        : { datos: resultados }),
    };
  }

  /**
   * Genera un CSV con el reporte de errores para descarga por el usuario.
   * Siempre incluye cabecera. Retorna cadena vacía (solo cabecera) si no hay errores.
   */
  generarReporteCSV(result: ImportacionResult): string {
    const header = 'Fila,Campo,Error,ValorRecibido';
    const rows = result.errores.map((e) => {
      const cols = [
        e.fila,
        e.campo ?? '',
        e.error,
        e.valorRecibido != null ? String(e.valorRecibido) : '',
      ];
      return cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
    });
    return [header, ...rows].join('\n');
  }
}
