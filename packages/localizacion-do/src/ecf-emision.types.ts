/**
 * Tipos para la EMISIÓN de e-CF de venta (Capa 2, Sesión 4).
 *
 * SCOPE: solo los tipos de venta que una constructora emite a sus clientes.
 * 31 Crédito Fiscal, 32 Consumo, 33 Nota de Débito, 34 Nota de Crédito.
 */

/** Tipos de e-CF de venta soportados por la emisión (subconjunto de TipoNcf). */
export const TIPOS_ECF_VENTA = ['E31', 'E32', 'E33', 'E34'] as const;
export type TipoEcfVenta = (typeof TIPOS_ECF_VENTA)[number];

/** Tipos que SIEMPRE deben referenciar un e-CF de origen (ajustes). */
export const TIPOS_ECF_REQUIEREN_ORIGEN = ['E33', 'E34'] as const;

export function esTipoEcfVenta(tipo: string): tipo is TipoEcfVenta {
  return (TIPOS_ECF_VENTA as readonly string[]).includes(tipo);
}

export function esAjusteEcf(tipo: TipoEcfVenta): boolean {
  return (TIPOS_ECF_REQUIEREN_ORIGEN as readonly string[]).includes(tipo);
}

/** Ambiente de emisión ante la DGII — cada empresa certifica primero en TEST/CERTIFICACION. */
export const AMBIENTES_EMISION_ECF = ['TEST', 'CERTIFICACION', 'PRODUCCION'] as const;
export type AmbienteEmisionEcf = (typeof AMBIENTES_EMISION_ECF)[number];

export interface EcfMonto {
  amount: string;
  currency: string;
}

/** Datos del receptor (cliente) embebidos en el comprobante. */
export interface EcfReceptor {
  rncOCedula: string;
  razonSocial: string;
}

/** Referencia al e-CF de origen — obligatoria para 33/34 (ADR-0007 §3). */
export interface EcfReferenciaOrigen {
  ncfOrigen: string;
  fechaEmisionOrigen: string;
  montoOrigen: EcfMonto;
}

/** Entrada para construir un comprobante e-CF de venta. */
export interface EcfEmisionInput {
  tipo: TipoEcfVenta;
  ncf: string;
  ambiente: AmbienteEmisionEcf;
  rncEmisor: string;
  razonSocialEmisor: string;
  fechaEmision: string;
  receptor: EcfReceptor;
  montoSubtotal: EcfMonto;
  montoItbis: EcfMonto;
  montoTotal: EcfMonto;
  /** Motivo del ajuste — requerido para 33/34. */
  motivoAjuste?: string;
  /** Requerido para 33/34 — ver TIPOS_ECF_REQUIEREN_ORIGEN. */
  referenciaOrigen?: EcfReferenciaOrigen;
}

/** Estructura del comprobante e-CF construida — lo que se transmite al middleware. */
export interface EcfDocumento {
  version: '1.0';
  tipo: TipoEcfVenta;
  ncf: string;
  ambiente: AmbienteEmisionEcf;
  emisor: { rnc: string; razonSocial: string };
  receptor: EcfReceptor;
  fechaEmision: string;
  totales: { montoSubtotal: EcfMonto; montoItbis: EcfMonto; montoTotal: EcfMonto };
  referenciaOrigen?: EcfReferenciaOrigen;
}

/** Resultado de transmitir un documento al middleware e-CF. */
export type EstadoTransmisionEcf = 'ACEPTADO' | 'RECHAZADO' | 'CONTINGENCIA';

export interface MiddlewareEcfRespuesta {
  estado: EstadoTransmisionEcf;
  codigoSeguridad?: string;
  fechaRecepcionDgii?: string;
  mensaje?: string;
  payloadAcuse: Record<string, unknown>;
}
