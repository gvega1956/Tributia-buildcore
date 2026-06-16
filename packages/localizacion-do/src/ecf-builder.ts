/**
 * EcfBuilder — construcción pura de la estructura del comprobante e-CF de venta.
 *
 * SCOPE Capa 2 (Sesión 4): construye el documento que se transmite al middleware
 * (ADR-0007). No realiza I/O — el llamador (apps/api) decide qué hacer con el
 * documento construido (transmitirlo, persistirlo, generar su RI si hace falta).
 */
import { esAjusteEcf, type EcfDocumento, type EcfEmisionInput, type TipoEcfVenta } from './ecf-emision.types.js';

/**
 * Construye el NCF de un e-CF a partir de su tipo y el número de secuencia
 * asignado por la empresa emisora (secuencia_ecf en apps/api).
 *
 * Formato: E + 2 dígitos de tipo + 8 dígitos de secuencia (mismo formato que
 * REGEX_ECF en ecf-validator.ts, para que un e-CF propio sea válido también
 * como e-CF recibido si llegara a circular como tal).
 */
export function construirNcf(tipo: TipoEcfVenta, numero: number): string {
  if (!Number.isInteger(numero) || numero < 1 || numero > 99_999_999) {
    throw new Error(`Número de secuencia NCF fuera de rango: ${numero}`);
  }
  const tipoNumerico = tipo.slice(1);
  return `E${tipoNumerico}${numero.toString().padStart(8, '0')}`;
}

/**
 * Construye el comprobante e-CF a partir de los datos de emisión.
 *
 * Reglas:
 *   - 33 (Nota de Débito) y 34 (Nota de Crédito) DEBEN traer `referenciaOrigen`
 *     — un ajuste sin comprobante de origen no es válido ante la DGII.
 *   - 31/32 NO deben traer `referenciaOrigen` — son comprobantes primarios.
 *
 * @throws Error si la combinación tipo/referenciaOrigen es inválida.
 */
export function construirComprobanteEcf(input: EcfEmisionInput): EcfDocumento {
  const requiereOrigen = esAjusteEcf(input.tipo);

  if (requiereOrigen && !input.referenciaOrigen) {
    throw new Error(
      `e-CF tipo ${input.tipo} es un ajuste (nota de débito/crédito) y requiere referenciaOrigen ` +
        `(el e-CF que modifica). No se puede emitir sin ella.`,
    );
  }
  if (!requiereOrigen && input.referenciaOrigen) {
    throw new Error(
      `e-CF tipo ${input.tipo} es un comprobante primario y no debe traer referenciaOrigen.`,
    );
  }

  return {
    version: '1.0',
    tipo: input.tipo,
    ncf: input.ncf,
    ambiente: input.ambiente,
    emisor: { rnc: input.rncEmisor, razonSocial: input.razonSocialEmisor },
    receptor: input.receptor,
    fechaEmision: input.fechaEmision,
    totales: {
      montoSubtotal: input.montoSubtotal,
      montoItbis: input.montoItbis,
      montoTotal: input.montoTotal,
    },
    ...(input.referenciaOrigen ? { referenciaOrigen: input.referenciaOrigen } : {}),
  };
}
