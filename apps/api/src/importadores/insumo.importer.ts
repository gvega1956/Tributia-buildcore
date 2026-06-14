import { and, eq } from 'drizzle-orm';
import { ImportadorBase, type ImportContext, type FilaError } from '@tributia/importadores';
import type { ImportacionResult } from '@tributia/importadores';
import { z } from 'zod';
import { DbService } from '../database/db.service.js';
import { InsumoService } from '../catalogos/insumo.service.js';
import { unidadesMedida } from '../db/schema/catalogos/unidad_medida.js';
import type { InsumoSelect } from '../db/schema/catalogos/insumo.js';

const CATEGORIAS = ['MATERIAL', 'CONSUMIBLE', 'HERRAMIENTA_MENOR', 'QUIMICO', 'COMBUSTIBLE', 'OTRO'] as const;

const zFilaInsumo = z.object({
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(500).nullable(),
  unidadCodigo: z.string().min(1).max(10),
  categoria: z.enum(CATEGORIAS).default('MATERIAL'),
  codigoDgii: z.string().max(20).nullable(),
});

type FilaInsumo = z.infer<typeof zFilaInsumo>;

/**
 * Importador de catálogo de insumos desde Excel.
 *
 * Columnas esperadas (fila 1 = encabezados, filas 2+ = datos):
 *   A: codigo       — código único del insumo (requerido)
 *   B: nombre       — nombre descriptivo (requerido)
 *   C: descripcion  — detalle adicional (opcional)
 *   D: unidad       — código de unidad de medida existente p.e. SC, KG (requerido)
 *   E: categoria    — MATERIAL|CONSUMIBLE|HERRAMIENTA_MENOR|QUIMICO|COMBUSTIBLE|OTRO
 *   F: codigo_dgii  — código bien/servicio DGII (opcional)
 */
export class InsumoImporter extends ImportadorBase<FilaInsumo, InsumoSelect> {
  readonly columnas = ['codigo', 'nombre', 'descripcion', 'unidad', 'categoria', 'codigo_dgii'];

  constructor(
    private readonly db: DbService,
    private readonly insumoService: InsumoService,
  ) {
    super();
  }

  protected validarFila(
    valores: (string | number | null)[],
    fila: number,
  ): { ok: true; data: FilaInsumo } | { ok: false; errores: FilaError[] } {
    const raw = {
      codigo: valores[0] != null ? String(valores[0]) : null,
      nombre: valores[1] != null ? String(valores[1]) : null,
      descripcion: valores[2] != null ? String(valores[2]) : null,
      unidadCodigo: valores[3] != null ? String(valores[3]) : null,
      categoria: valores[4] != null ? String(valores[4]).toUpperCase() : 'MATERIAL',
      codigoDgii: valores[5] != null ? String(valores[5]) : null,
    };

    const parsed = zFilaInsumo.safeParse(raw);
    if (!parsed.success) {
      const errores: FilaError[] = parsed.error.issues.map((issue) => ({
        fila,
        campo: issue.path.join('.'),
        error: issue.message,
        valorRecibido: raw[issue.path[0] as keyof typeof raw],
      }));
      return { ok: false, errores };
    }

    return { ok: true, data: parsed.data };
  }

  protected async procesarFila(
    fila: FilaInsumo,
    ctx: ImportContext,
  ): Promise<InsumoSelect> {
    const [unidad] = await this.db.tx
      .select({ id: unidadesMedida.id })
      .from(unidadesMedida)
      .where(
        and(
          eq(unidadesMedida.tenantId, ctx.tenantId),
          eq(unidadesMedida.codigo, fila.unidadCodigo.toUpperCase()),
          eq(unidadesMedida.activo, true),
        ),
      )
      .limit(1);

    if (!unidad) {
      throw new Error(
        `Unidad de medida '${fila.unidadCodigo}' no existe para este tenant. Créela primero.`,
      );
    }

    return this.insumoService.create(ctx.tenantId, ctx.usuarioId, {
      codigo: fila.codigo,
      nombre: fila.nombre,
      descripcion: fila.descripcion,
      unidadId: unidad.id,
      categoria: fila.categoria,
      codigoDgii: fila.codigoDgii,
    });
  }
}

export type { ImportacionResult };
