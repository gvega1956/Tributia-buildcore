import Decimal from 'decimal.js';
import { z } from 'zod';
import { zBusinessDate } from '@tributia/shared';

export type TipoAsiento = 'automatico' | 'ajuste' | 'apertura' | 'cierre';
export type EstadoAsiento = 'borrador' | 'confirmado' | 'reversado';
export type TipoLinea = 'debe' | 'haber';

export interface LineaAsientoInput {
  cuentaCodigo: string;
  tipo: TipoLinea;
  importe: string; // NUMERIC(18,4) como string — siempre positivo
  moneda: string;
  descripcion?: string;
}

export interface AsientoInput {
  tenantId: string;
  empresaId: string;
  tipo: TipoAsiento;
  eventoId?: string;
  reglaId?: string;
  fecha: string; // 'YYYY-MM-DD'
  descripcion: string;
  lineas: LineaAsientoInput[];
  usuarioId: string;
}

// ─── Schemas Zod para formularios del frontend ───────────────────────────────

export const zLineaAjuste = z.object({
  cuentaCodigo: z.string().min(1).max(20),
  tipo: z.enum(['debe', 'haber']),
  importe: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Importe decimal positivo'),
  moneda: z.enum(['DOP', 'USD', 'EUR']).default('DOP'),
  descripcion: z.string().max(300).optional(),
});

export const zAsientoAjusteCreate = z.object({
  empresaId: z.string().uuid('empresaId debe ser UUID'),
  fecha: zBusinessDate,
  descripcion: z.string().min(5).max(500),
  lineas: z.array(zLineaAjuste).min(2, 'El asiento requiere al menos 2 líneas'),
});

export type LineaAjusteInput = z.infer<typeof zLineaAjuste>;
export type AsientoAjusteCreateInput = z.infer<typeof zAsientoAjusteCreate>;

/**
 * Valida que un conjunto de líneas de asiento esté balanceado.
 * Función pura — no toca la BD. Usada por AsientoContableService y sus tests.
 *
 * Invariante P4: para todo asiento, Σ(debe) = Σ(haber).
 */
export function validarBalance(lineas: LineaAsientoInput[]): boolean {
  const totalDebe = lineas
    .filter((l) => l.tipo === 'debe')
    .reduce((s, l) => s.plus(l.importe), new Decimal(0));
  const totalHaber = lineas
    .filter((l) => l.tipo === 'haber')
    .reduce((s, l) => s.plus(l.importe), new Decimal(0));
  return totalDebe.equals(totalHaber);
}
