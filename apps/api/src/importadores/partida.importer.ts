import { Injectable, BadRequestException } from '@nestjs/common';
import { ImportadorBase, type ImportContext } from '@tributia/importadores';
import type { FilaError } from '@tributia/importadores';
import type { PartidaSelect } from '../db/schema/proyectos/partida.js';
import { PartidaService } from '../proyectos/partida.service.js';

interface EdtFila {
  codigo: string;          // ej. "01", "01.01", "01.01.01"
  nombre: string;
  unidad: string | null;   // código de unidad_medida; null para capítulos
  cantidad: string | null; // NUMERIC(18,4) como string
  precioUnitario: string | null;
}

/**
 * Importador de EDT desde Excel.
 *
 * Columnas esperadas (en orden):
 *   A: codigo           — jerárquico con puntos: "01", "01.01", "01.01.01"
 *   B: nombre
 *   C: unidad           — código de unidad_medida (vacío para capítulos)
 *   D: cantidad         — número decimal (vacío para capítulos)
 *   E: precio_unitario  — número decimal (opcional)
 *
 * El nivel se deriva del número de segmentos separados por puntos:
 *   0 puntos → Capítulo (nivel 1)
 *   1 punto  → Partida  (nivel 2)
 *   2 puntos → Sub-partida (nivel 3)
 *
 * El padre se determina por el prefijo del código:
 *   "01.02.03" → padre tiene código "01.02"
 */
@Injectable()
export class PartidaImporter extends ImportadorBase<EdtFila, PartidaSelect> {
  readonly columnas = ['codigo', 'nombre', 'unidad', 'cantidad', 'precio_unitario'];

  /** Mapa de código → id de partida insertada, para resolver parentId en cascada. */
  private codigoToId = new Map<string, string>();

  constructor(private readonly partidaService: PartidaService) {
    super();
  }

  override async importar(
    buffer: Buffer,
    ctx: ImportContext,
    simulacion = false,
  ) {
    this.codigoToId.clear();
    return super.importar(buffer, ctx, simulacion);
  }

  protected validarFila(
    valores: (string | number | null)[],
    fila: number,
  ): { ok: true; data: EdtFila } | { ok: false; errores: FilaError[] } {
    const errores: FilaError[] = [];

    const codigo = typeof valores[0] === 'string' ? valores[0].trim() : null;
    const nombre = typeof valores[1] === 'string' ? valores[1].trim() : null;
    const unidadRaw = valores[2];
    const cantidadRaw = valores[3];
    const precioRaw = valores[4];

    if (!codigo) {
      errores.push({ fila, campo: 'codigo', error: 'Requerido', valorRecibido: codigo });
    } else {
      const partes = codigo.split('.');
      if (partes.length > 3 || partes.some((p) => !/^\d+$/.test(p))) {
        errores.push({
          fila,
          campo: 'codigo',
          error: 'Formato inválido. Use "01", "01.01" o "01.01.01"',
          valorRecibido: codigo,
        });
      }
    }

    if (!nombre) {
      errores.push({ fila, campo: 'nombre', error: 'Requerido', valorRecibido: nombre });
    }

    const unidad = unidadRaw != null && String(unidadRaw).trim() ? String(unidadRaw).trim() : null;
    let cantidad: string | null = null;
    if (cantidadRaw != null && String(cantidadRaw).trim()) {
      const n = Number(cantidadRaw);
      if (isNaN(n) || n < 0) {
        errores.push({ fila, campo: 'cantidad', error: 'Debe ser un número >= 0', valorRecibido: cantidadRaw });
      } else {
        cantidad = n.toFixed(4);
      }
    }

    let precioUnitario: string | null = null;
    if (precioRaw != null && String(precioRaw).trim()) {
      const p = Number(precioRaw);
      if (isNaN(p) || p < 0) {
        errores.push({ fila, campo: 'precio_unitario', error: 'Debe ser un número >= 0', valorRecibido: precioRaw });
      } else {
        precioUnitario = p.toFixed(4);
      }
    }

    if (errores.length > 0) return { ok: false, errores };

    return {
      ok: true,
      data: { codigo: codigo!, nombre: nombre!, unidad, cantidad, precioUnitario },
    };
  }

  protected async procesarFila(fila: EdtFila, ctx: ImportContext): Promise<PartidaSelect> {
    if (!ctx.proyectoId) {
      throw new BadRequestException('proyectoId requerido en el contexto del importador de EDT.');
    }
    if (!ctx.empresaId) {
      throw new BadRequestException('empresaId requerido en el contexto del importador de EDT.');
    }

    const partes = fila.codigo.split('.');
    const parentCodigo = partes.length > 1 ? partes.slice(0, -1).join('.') : null;
    const parentId = parentCodigo ? (this.codigoToId.get(parentCodigo) ?? null) : null;

    if (parentCodigo && !parentId) {
      throw new BadRequestException(
        `Padre con código "${parentCodigo}" no encontrado. Verifique el orden de las filas en el Excel.`,
      );
    }

    const partida = await this.partidaService.create(
      ctx.tenantId,
      ctx.proyectoId,
      ctx.empresaId,
      ctx.usuarioId,
      {
        codigo: fila.codigo,
        nombre: fila.nombre,
        parentId,
        unidadMedidaId: null,  // La unidad se resuelve por código en una iteración posterior (fuera de scope)
        cantidadPresupuestada: fila.cantidad,
        precioUnitario: fila.precioUnitario,
      },
    );

    this.codigoToId.set(fila.codigo, partida.id);
    return partida;
  }
}
