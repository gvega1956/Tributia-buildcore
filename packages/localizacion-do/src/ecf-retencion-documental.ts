/**
 * Plazo de retención documental fiscal para e-CF y acuses (§22 arquitectura.md).
 *
 * 10 años desde la fecha de emisión — Código Tributario RD, art. 50
 * (conservación de documentación y registros). Si el contador del cliente
 * exige un plazo distinto, se ajusta aquí en un solo lugar (ADR-0007 §3).
 */
export const ANOS_RETENCION_FISCAL_RD = 10;

/** Calcula la fecha límite hasta la cual el e-CF/acuse debe conservarse. */
export function calcularFechaLimiteRetencion(fechaEmision: Date): Date {
  const limite = new Date(fechaEmision);
  limite.setUTCFullYear(limite.getUTCFullYear() + ANOS_RETENCION_FISCAL_RD);
  return limite;
}
