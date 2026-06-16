/**
 * Contingencia y Representación Impresa (RI) — §17 arquitectura.md.
 *
 * Cuando el middleware e-CF o la DGII no están disponibles, la operación de
 * la constructora NO se bloquea: el comprobante se emite en contingencia y
 * se entrega al cliente una RI (representación impresa) con código de
 * seguridad, mientras se regulariza (transmite) dentro del plazo límite.
 */
import { calcularHashIntegridad } from './ecf-integridad.js';
import type { EcfDocumento } from './ecf-emision.types.js';

/** Motivos de contingencia reconocidos. */
export const MOTIVOS_CONTINGENCIA = [
  'MIDDLEWARE_NO_DISPONIBLE',
  'DGII_NO_DISPONIBLE',
  'SIN_CONEXION',
] as const;
export type MotivoContingencia = (typeof MOTIVOS_CONTINGENCIA)[number];

/** Plazo DGII para regularizar (transmitir) un comprobante emitido en contingencia. */
export const HORAS_LIMITE_REGULARIZACION_CONTINGENCIA = 72;

export interface RepresentacionImpresa {
  numeroRi: string;
  codigoSeguridad: string;
  motivo: MotivoContingencia;
  fechaEmision: string;
  fechaLimiteRegularizacion: string;
  /** Contenido a codificar en el QR de la RI impresa. */
  qrPayload: string;
}

/**
 * Genera la Representación Impresa de un comprobante emitido en contingencia.
 *
 * El código de seguridad se deriva de un hash determinista del documento (no
 * es el código que la DGII asignaría tras la regularización — ese llega con
 * el acuse real cuando se transmite — sino el código de seguridad *temporal*
 * que la norma exige imprimir en la RI mientras tanto).
 */
export function generarRepresentacionImpresa(
  documento: EcfDocumento,
  motivo: MotivoContingencia,
  fechaEmision: Date,
): RepresentacionImpresa {
  const hash = calcularHashIntegridad(documento);
  const codigoSeguridad = hash.slice(0, 12).toUpperCase();
  const numeroRi = `RI-${documento.ncf}`;

  const limite = new Date(fechaEmision);
  limite.setUTCHours(limite.getUTCHours() + HORAS_LIMITE_REGULARIZACION_CONTINGENCIA);

  const qrPayload = JSON.stringify({
    rnc: documento.emisor.rnc,
    ncf: documento.ncf,
    monto: documento.totales.montoTotal.amount,
    fecha: documento.fechaEmision,
    codigoSeguridad,
  });

  return {
    numeroRi,
    codigoSeguridad,
    motivo,
    fechaEmision: fechaEmision.toISOString(),
    fechaLimiteRegularizacion: limite.toISOString(),
    qrPayload,
  };
}
