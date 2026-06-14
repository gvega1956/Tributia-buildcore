import Decimal from 'decimal.js';

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
