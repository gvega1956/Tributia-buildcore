import { Injectable, BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import Decimal from 'decimal.js';
import type { ImportContext } from '@tributia/importadores';
import type { MapeoColumnasPresupuesto } from '@tributia/proyectos';
import type { ImportarPresupuestoInput } from '@tributia/proyectos';
import { PartidaService } from '../proyectos/partida.service.js';
import { PresupuestoService } from '../proyectos/presupuesto.service.js';

interface FilaPresupuesto {
  rowNumber: number;
  codigo: string;
  nombre: string;
  unidad: string | null;
  cantidad: string;
  precioUnitario: string;
  esIndirecto: boolean;
}

interface FilaError {
  fila: number;
  campo?: string;
  error: string;
  valorRecibido?: unknown;
}

export interface ResultadoImportPresupuesto {
  totalFilas: number;
  procesadas: number;
  omitidas: number;
  errores: FilaError[];
  simulacion: boolean;
  versionId: string | null;
  versionNombre: string;
}

/**
 * Importador de presupuestos desde Excel con mapeo de columnas configurable.
 *
 * Flujo:
 *   1. Lee el Excel fila por fila.
 *   2. Valida todas las filas (sin tocar la BD).
 *   3. Si hay errores de validación, retorna reporte sin guardar.
 *   4. Si simulacion=true, retorna resumen sin guardar.
 *   5. Si no: crea version_presupuesto BORRADOR, busca/crea partidas por código
 *      y crea linea_presupuesto para cada fila válida.
 *
 * Mapeo de columnas: cada campo se mapea a una letra de columna Excel (A, B, C...).
 * Esto permite adaptar el importador a cualquier formato de Excel de constructora
 * sin modificar el código.
 */
@Injectable()
export class PresupuestoImporter {
  constructor(
    private readonly partidaService: PartidaService,
    private readonly presupuestoService: PresupuestoService,
  ) {}

  async importarPresupuesto(
    buffer: Buffer,
    ctx: ImportContext,
    input: ImportarPresupuestoInput,
  ): Promise<ResultadoImportPresupuesto> {
    if (!ctx.proyectoId) {
      throw new BadRequestException('proyectoId requerido para importar presupuesto.');
    }
    if (!ctx.empresaId) {
      throw new BadRequestException('empresaId requerido para importar presupuesto.');
    }

    const { mapeo, versionNombre, simulacion } = input;
    const colIndices = resolverIndices(mapeo);
    const maxIdx = Math.max(...Object.values(colIndices).filter((v): v is number => v !== null));

    // ── Lectura del Excel ────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(Readable.from(buffer));
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('El archivo Excel no contiene hojas de cálculo.');

    const rawRows: { rowNumber: number; valores: (string | number | null)[] }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // encabezados
      const raw = row.values as unknown[];
      const valores: (string | number | null)[] = [];
      for (let i = 1; i <= maxIdx + 1; i++) {
        valores.push(normalizarCelda(raw[i]));
      }
      rawRows.push({ rowNumber, valores });
    });

    // ── Validación ────────────────────────────────────────────────────────────
    const errores: FilaError[] = [];
    const filasValidas: FilaPresupuesto[] = [];

    for (const { rowNumber, valores } of rawRows) {
      const result = validarFila(valores, rowNumber, colIndices);
      if (!result.ok) {
        errores.push(...result.errores);
      } else {
        filasValidas.push(result.data);
      }
    }

    if (errores.length > 0 || simulacion) {
      return {
        totalFilas: rawRows.length,
        procesadas: simulacion ? filasValidas.length : 0,
        omitidas: rawRows.length - (simulacion ? filasValidas.length : 0),
        errores,
        simulacion,
        versionId: null,
        versionNombre,
      };
    }

    // ── Persistencia ──────────────────────────────────────────────────────────
    // 1. Crear la versión BORRADOR
    const version = await this.presupuestoService.createVersion(
      ctx.tenantId, ctx.proyectoId, ctx.empresaId ?? '', ctx.usuarioId,
      { nombre: versionNombre, tipo: 'BORRADOR', notas: 'Importado desde Excel', moneda: 'DOP', snapshotPartidas: false },
    );

    const procesadas: number[] = [];
    const erroresGuardado: FilaError[] = [];

    // 2. Procesar cada fila: encontrar o crear la partida, luego crear la línea
    const codigoToPartidaId = new Map<string, string>();

    for (const fila of filasValidas) {
      try {
        let partidaId = codigoToPartidaId.get(fila.codigo);

        if (!partidaId) {
          const { id } = await this.encontrarOCrearPartida(
            ctx, fila, codigoToPartidaId,
          );
          partidaId = id;
          codigoToPartidaId.set(fila.codigo, partidaId);
        }

        await this.presupuestoService.addLinea(
          ctx.tenantId, ctx.proyectoId ?? '', ctx.empresaId ?? '', ctx.usuarioId,
          version.id,
          {
            partidaId,
            apuId: null,
            cantidad: fila.cantidad,
            precioUnitario: fila.precioUnitario,
            esIndirecto: fila.esIndirecto,
          },
        );
        procesadas.push(fila.rowNumber);
      } catch (err: unknown) {
        erroresGuardado.push({
          fila: fila.rowNumber,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      totalFilas: rawRows.length,
      procesadas: procesadas.length,
      omitidas: rawRows.length - procesadas.length,
      errores: erroresGuardado,
      simulacion: false,
      versionId: version.id,
      versionNombre,
    };
  }

  /**
   * Genera reporte CSV de errores para descarga.
   */
  generarReporteCSV(errores: FilaError[]): string {
    const header = 'Fila,Campo,Error,ValorRecibido';
    const rows = errores.map((e) => {
      const cols = [e.fila, e.campo ?? '', e.error, e.valorRecibido != null ? String(e.valorRecibido) : ''];
      return cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
    });
    return [header, ...rows].join('\n');
  }

  // ── Helpers privados ────────────────────────────────────────────────────────

  private async encontrarOCrearPartida(
    ctx: ImportContext,
    fila: FilaPresupuesto,
    codigoToId: Map<string, string>,
  ): Promise<{ id: string }> {
    const { tenantId, proyectoId, empresaId, usuarioId } = ctx;

    // Intentar obtener árbol para encontrar por código
    const arbol = await this.partidaService.findTree(
      tenantId, proyectoId!, empresaId!, usuarioId,
    );
    const existente = arbol.find((p) => p.codigo === fila.codigo);
    if (existente) {
      return { id: existente.id };
    }

    // Determinar nivel por puntos en el código (ej. "01.02.03" → nivel 3)
    const partes = fila.codigo.split('.');
    const parentCodigo = partes.length > 1 ? partes.slice(0, -1).join('.') : null;
    let parentId: string | null = null;

    if (parentCodigo) {
      parentId = codigoToId.get(parentCodigo) ?? null;
      if (!parentId) {
        const parentEnArbol = arbol.find((p) => p.codigo === parentCodigo);
        parentId = parentEnArbol?.id ?? null;
      }
    }

    const partida = await this.partidaService.create(
      tenantId, proyectoId!, empresaId!, usuarioId,
      {
        codigo: fila.codigo,
        nombre: fila.nombre,
        parentId,
        unidadMedidaId: null,
        cantidadPresupuestada: fila.cantidad,
        precioUnitario: fila.precioUnitario,
      },
    );

    return { id: partida.id };
  }
}

// ── Utilidades puras ──────────────────────────────────────────────────────────

interface ColIndices {
  codigo: number;
  nombre: number;
  unidad: number;
  cantidad: number;
  precioUnitario: number;
  esIndirecto: number | null;
}

function letraAIndice(letra: string): number {
  // 'A' → 0, 'B' → 1, ..., 'Z' → 25, 'AA' → 26, etc. (0-based)
  const upper = letra.trim().toUpperCase();
  if (/^\d+$/.test(upper)) {
    // También aceptamos número 1-based como string ("1", "2", ...)
    return parseInt(upper, 10) - 1;
  }
  let result = 0;
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result - 1; // 0-based
}

function resolverIndices(mapeo: MapeoColumnasPresupuesto): ColIndices {
  return {
    codigo: letraAIndice(mapeo.codigo),
    nombre: letraAIndice(mapeo.nombre),
    unidad: letraAIndice(mapeo.unidad),
    cantidad: letraAIndice(mapeo.cantidad),
    precioUnitario: letraAIndice(mapeo.precioUnitario),
    esIndirecto: mapeo.esIndirecto ? letraAIndice(mapeo.esIndirecto) : null,
  };
}

function normalizarCelda(cell: unknown): string | number | null {
  if (cell == null) return null;
  if (typeof cell === 'string') return cell.trim() || null;
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'boolean') return String(cell);
  if (cell instanceof Date) return cell.toISOString().split('T')[0] ?? null;
  if (typeof cell === 'object' && 'richText' in cell) {
    const rt = cell as { richText: { text: string }[] };
    return rt.richText.map((r) => r.text).join('').trim() || null;
  }
  if (typeof cell === 'object' && 'result' in cell) {
    return normalizarCelda((cell as { result: unknown }).result);
  }
  if (typeof cell === 'object' && 'text' in cell) {
    return normalizarCelda((cell as { text: unknown }).text);
  }
  return String(cell);
}

function validarFila(
  valores: (string | number | null)[],
  rowNumber: number,
  idx: ColIndices,
): { ok: true; data: FilaPresupuesto } | { ok: false; errores: FilaError[] } {
  const errores: FilaError[] = [];

  const codigoRaw = valores[idx.codigo];
  const nombreRaw = valores[idx.nombre];
  const cantidadRaw = valores[idx.cantidad];
  const precioRaw = valores[idx.precioUnitario];
  const unidadRaw = valores[idx.unidad];
  const esIndirectoRaw = idx.esIndirecto !== null ? valores[idx.esIndirecto] : null;

  const codigo =
    codigoRaw != null && String(codigoRaw).trim()
      ? String(codigoRaw).trim()
      : null;
  const nombre =
    nombreRaw != null && String(nombreRaw).trim()
      ? String(nombreRaw).trim()
      : null;

  if (!codigo) {
    errores.push({ fila: rowNumber, campo: 'codigo', error: 'Requerido', valorRecibido: codigoRaw });
  }
  if (!nombre) {
    errores.push({ fila: rowNumber, campo: 'nombre', error: 'Requerido', valorRecibido: nombreRaw });
  }

  let cantidad = '0.0000';
  if (cantidadRaw != null && String(cantidadRaw).trim()) {
    try {
      const d = new Decimal(String(cantidadRaw));
      if (d.isNegative()) {
        errores.push({ fila: rowNumber, campo: 'cantidad', error: 'Debe ser >= 0', valorRecibido: cantidadRaw });
      } else {
        cantidad = d.toFixed(4);
      }
    } catch {
      errores.push({ fila: rowNumber, campo: 'cantidad', error: 'Número inválido', valorRecibido: cantidadRaw });
    }
  }

  let precioUnitario = '0.0000';
  if (precioRaw != null && String(precioRaw).trim()) {
    try {
      const d = new Decimal(String(precioRaw));
      if (d.isNegative()) {
        errores.push({ fila: rowNumber, campo: 'precio_unitario', error: 'Debe ser >= 0', valorRecibido: precioRaw });
      } else {
        precioUnitario = d.toFixed(4);
      }
    } catch {
      errores.push({
        fila: rowNumber,
        campo: 'precio_unitario',
        error: 'Número inválido',
        valorRecibido: precioRaw,
      });
    }
  }

  const unidad =
    unidadRaw != null && String(unidadRaw).trim()
      ? String(unidadRaw).trim()
      : null;

  const esIndirectoStr =
    esIndirectoRaw != null ? String(esIndirectoRaw).trim().toLowerCase() : '';
  const esIndirecto =
    esIndirectoStr === 'true' || esIndirectoStr === 'si' || esIndirectoStr === 'sí' || esIndirectoStr === '1';

  if (errores.length > 0) return { ok: false, errores };

  return {
    ok: true,
    data: {
      rowNumber,
      codigo: codigo!,
      nombre: nombre!,
      unidad,
      cantidad,
      precioUnitario,
      esIndirecto,
    },
  };
}
