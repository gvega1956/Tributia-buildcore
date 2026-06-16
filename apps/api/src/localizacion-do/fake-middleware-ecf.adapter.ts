import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { IMiddlewareEcfClient, EcfDocumento, MiddlewareEcfRespuesta } from '@tributia/localizacion-do';

/**
 * FakeMiddlewareEcfAdapter — implementación de IMiddlewareEcfClient mientras
 * no hay un middleware e-CF real alcanzable desde este entorno (ADR-0007 §1).
 *
 * Modo log-only, igual que SmtpAdapter/StorageService: nunca lanza por
 * indisponibilidad. Si ECF_MIDDLEWARE_FORZAR_CONTINGENCIA=true, simula que
 * el middleware/DGII no responden (para ejercitar la ruta de RI). De lo
 * contrario simula una transmisión ACEPTADA con un acuse sintético.
 */
@Injectable()
export class FakeMiddlewareEcfAdapter implements IMiddlewareEcfClient {
  private readonly logger = new Logger(FakeMiddlewareEcfAdapter.name);

  constructor(@Optional() private readonly config?: ConfigService) {}

  transmitir(documento: EcfDocumento): Promise<MiddlewareEcfRespuesta> {
    const forzarContingencia = this.config?.get<string>('ECF_MIDDLEWARE_FORZAR_CONTINGENCIA') === 'true';

    if (forzarContingencia) {
      this.logger.warn(
        `Middleware e-CF no disponible (forzado por configuración) — ncf=${documento.ncf} entra en contingencia`,
      );
      return Promise.resolve({ estado: 'CONTINGENCIA', payloadAcuse: {} });
    }

    const codigoSeguridad = randomBytes(6).toString('hex').toUpperCase();
    const fechaRecepcionDgii = new Date().toISOString();
    this.logger.log(
      `[ECF-LOG] Transmisión simulada al middleware — ncf=${documento.ncf} tipo=${documento.tipo} estado=ACEPTADO`,
    );

    return Promise.resolve({
      estado: 'ACEPTADO',
      codigoSeguridad,
      fechaRecepcionDgii,
      payloadAcuse: {
        ncf: documento.ncf,
        tipo: documento.tipo,
        ambiente: documento.ambiente,
        codigoSeguridad,
        fechaRecepcionDgii,
        totales: documento.totales,
      },
    });
  }
}
