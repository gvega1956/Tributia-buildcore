/**
 * Puerto del middleware e-CF — contrato puro (ADR-0007 §1).
 *
 * El middleware e-CF es un servicio EXTERNO ya existente y probado, con su
 * propio ciclo de versiones (docs/arquitectura.md §17 y tabla de decisiones:
 * "Middleware existente como servicio interno independiente"). Este paquete
 * NO lo implementa — solo define el contrato que cualquier adaptador
 * (apps/api) debe cumplir. El adaptador real (HTTP) y el adaptador falso
 * (desarrollo/pruebas) viven en apps/api/src/localizacion-do/.
 */
import type { EcfDocumento, MiddlewareEcfRespuesta } from './ecf-emision.types.js';

export interface IMiddlewareEcfClient {
  /**
   * Transmite un comprobante e-CF construido al middleware para su envío a
   * la DGII bajo el certificado y autorización de la empresa emisora.
   *
   * El adaptador NUNCA debe lanzar para fallos esperables de disponibilidad
   * (DGII/middleware caídos) — debe devolver `estado: 'CONTINGENCIA'`. Solo
   * debe lanzar ante errores de programación (documento inválido, etc.).
   */
  transmitir(documento: EcfDocumento): Promise<MiddlewareEcfRespuesta>;
}
