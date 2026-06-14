import { and, eq, isNull } from 'drizzle-orm';
import { ImportadorBase, type ImportContext, type FilaError } from '@tributia/importadores';
import type { ImportacionResult } from '@tributia/importadores';
import { z } from 'zod';
import { DbService } from '../database/db.service.js';
import { ProyectoService } from '../proyectos/proyecto.service.js';
import { terceros } from '../db/schema/catalogos/tercero.js';
import type { ProyectoSelect } from '../db/schema/proyectos/proyecto.js';
import { TIPOS_OBRA } from '@tributia/proyectos';

const zFilaProyecto = z.object({
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(200),
  tipoObra: z.enum(TIPOS_OBRA),
  clienteRncCedula: z.string().min(1).max(20),
  numeroContrato: z.string().max(100).nullable(),
  montoContrato: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .nullable(),
  monedaContrato: z.string().length(3).default('DOP'),
  fechaInicioPlanificada: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  fechaFinPlanificada: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  ubicacion: z.string().max(500).nullable(),
});

type FilaProyecto = z.infer<typeof zFilaProyecto>;

/**
 * Importador de proyectos desde Excel.
 *
 * Columnas esperadas (fila 1 = encabezados, filas 2+ = datos):
 *   A: codigo                 — código único (requerido)
 *   B: nombre                 — nombre del proyecto (requerido)
 *   C: tipo_obra              — RESIDENCIAL|COMERCIAL|INDUSTRIAL|VIAL|HIDRAULICO|INSTITUCIONAL|MIXTO|OTRO
 *   D: cliente_rnc_cedula     — RNC/Cédula del tercero cliente (debe existir con es_cliente=true)
 *   E: numero_contrato        — número de contrato (opcional)
 *   F: monto_contrato         — monto numérico (opcional, ej: 5000000.0000)
 *   G: moneda_contrato        — DOP|USD (default DOP)
 *   H: fecha_inicio           — YYYY-MM-DD (opcional)
 *   I: fecha_fin              — YYYY-MM-DD (opcional)
 *   J: ubicacion              — descripción de ubicación (opcional)
 */
export class ProyectoImporter extends ImportadorBase<FilaProyecto, ProyectoSelect> {
  readonly columnas = [
    'codigo',
    'nombre',
    'tipo_obra',
    'cliente_rnc_cedula',
    'numero_contrato',
    'monto_contrato',
    'moneda_contrato',
    'fecha_inicio',
    'fecha_fin',
    'ubicacion',
  ];

  constructor(
    private readonly db: DbService,
    private readonly proyectoService: ProyectoService,
  ) {
    super();
  }

  protected validarFila(
    valores: (string | number | null)[],
    fila: number,
  ): { ok: true; data: FilaProyecto } | { ok: false; errores: FilaError[] } {
    const raw = {
      codigo: valores[0] != null ? String(valores[0]).trim() : null,
      nombre: valores[1] != null ? String(valores[1]).trim() : null,
      tipoObra: valores[2] != null ? String(valores[2]).trim().toUpperCase() : null,
      clienteRncCedula: valores[3] != null ? String(valores[3]).trim().replace(/-/g, '') : null,
      numeroContrato: valores[4] != null ? String(valores[4]).trim() : null,
      montoContrato: valores[5] != null ? String(valores[5]).trim() : null,
      monedaContrato: valores[6] != null ? String(valores[6]).trim().toUpperCase() : 'DOP',
      fechaInicioPlanificada: valores[7] != null ? String(valores[7]).trim() : null,
      fechaFinPlanificada: valores[8] != null ? String(valores[8]).trim() : null,
      ubicacion: valores[9] != null ? String(valores[9]).trim() : null,
    };

    const parsed = zFilaProyecto.safeParse(raw);
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
    fila: FilaProyecto,
    ctx: ImportContext,
  ): Promise<ProyectoSelect> {
    // Resolver tercero por RNC/Cédula
    const [tercero] = await this.db.tx
      .select({ id: terceros.id, esCliente: terceros.esCliente })
      .from(terceros)
      .where(
        and(
          eq(terceros.tenantId, ctx.tenantId),
          eq(terceros.rncCedula, fila.clienteRncCedula),
          isNull(terceros.deletedAt),
        ),
      )
      .limit(1);

    if (!tercero) {
      throw new Error(
        `Tercero con RNC/Cédula '${fila.clienteRncCedula}' no existe en este tenant.`,
      );
    }
    if (!tercero.esCliente) {
      throw new Error(
        `Tercero con RNC/Cédula '${fila.clienteRncCedula}' no tiene el rol cliente activado.`,
      );
    }

    return this.proyectoService.create(ctx.tenantId, ctx.empresaId!, ctx.usuarioId, {
      codigo: fila.codigo,
      nombre: fila.nombre,
      tipoObra: fila.tipoObra,
      clienteId: tercero.id,
      numeroContrato: fila.numeroContrato,
      montoContrato: fila.montoContrato,
      monedaContrato: fila.monedaContrato,
      fechaInicioPlanificada: fila.fechaInicioPlanificada,
      fechaFinPlanificada: fila.fechaFinPlanificada,
      ubicacionDescripcion: fila.ubicacion,
    });
  }
}

export type { ImportacionResult };
