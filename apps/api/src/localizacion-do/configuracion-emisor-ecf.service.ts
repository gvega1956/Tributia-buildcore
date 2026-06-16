import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { newId, zUUID } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { configuracionesEmisorEcf } from '../db/schema/localizacion-do/configuracion_emisor_ecf.js';
import { secuenciasEcf } from '../db/schema/localizacion-do/secuencia_ecf.js';

export const zConfiguracionEmisorDto = z.object({
  empresaId: zUUID,
  ambiente: z.enum(['TEST', 'CERTIFICACION', 'PRODUCCION']).default('TEST'),
  rncEmisor: z.string().regex(/^\d{9}$/, 'RNC debe tener 9 dígitos'),
  razonSocialEmisor: z.string().min(1).max(200),
  certificadoReferencia: z.string().min(1).max(500),
});
export type ConfiguracionEmisorDto = z.infer<typeof zConfiguracionEmisorDto>;

export const zInicializarSecuenciaDto = z.object({
  empresaId: zUUID,
  tipoEcf: z.enum(['E31', 'E32', 'E33', 'E34']),
  rangoAutorizadoDesde: z.number().int().min(1),
  rangoAutorizadoHasta: z.number().int().min(1),
});
export type InicializarSecuenciaDto = z.infer<typeof zInicializarSecuenciaDto>;

/**
 * ConfiguracionEmisorEcfService — alta del emisor electrónico por empresa y
 * de sus secuencias de NCF autorizadas (ADR-0007 §2).
 *
 * `certificadoReferencia` es SOLO un puntero opaco a la bóveda de secretos
 * externa — esta clase nunca recibe ni persiste el certificado en sí.
 */
@Injectable()
export class ConfiguracionEmisorEcfService {
  constructor(private readonly db: DbService) {}

  async configurar(tenantId: string, dto: ConfiguracionEmisorDto, usuarioId: string) {
    const now = new Date();
    const [config] = await this.db.tx
      .insert(configuracionesEmisorEcf)
      .values({
        id: newId(),
        tenantId,
        empresaId: dto.empresaId,
        ambiente: dto.ambiente,
        rncEmisor: dto.rncEmisor,
        razonSocialEmisor: dto.razonSocialEmisor,
        certificadoReferencia: dto.certificadoReferencia,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .onConflictDoUpdate({
        target: configuracionesEmisorEcf.empresaId,
        set: {
          ambiente: dto.ambiente,
          rncEmisor: dto.rncEmisor,
          razonSocialEmisor: dto.razonSocialEmisor,
          certificadoReferencia: dto.certificadoReferencia,
          activo: true,
          updatedAt: now,
          updatedBy: usuarioId,
        },
      })
      .returning();
    return config!;
  }

  async inicializarSecuencia(tenantId: string, dto: InicializarSecuenciaDto, usuarioId: string) {
    const now = new Date();
    const [secuencia] = await this.db.tx
      .insert(secuenciasEcf)
      .values({
        id: newId(),
        tenantId,
        empresaId: dto.empresaId,
        tipoEcf: dto.tipoEcf,
        proximoNumero: dto.rangoAutorizadoDesde,
        rangoAutorizadoDesde: dto.rangoAutorizadoDesde,
        rangoAutorizadoHasta: dto.rangoAutorizadoHasta,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .onConflictDoUpdate({
        target: [secuenciasEcf.empresaId, secuenciasEcf.tipoEcf],
        set: {
          rangoAutorizadoDesde: dto.rangoAutorizadoDesde,
          rangoAutorizadoHasta: dto.rangoAutorizadoHasta,
          updatedAt: now,
          updatedBy: usuarioId,
        },
      })
      .returning();
    return secuencia!;
  }

  async findConfiguracion(tenantId: string, empresaId: string) {
    const [config] = await this.db.tx
      .select()
      .from(configuracionesEmisorEcf)
      .where(and(eq(configuracionesEmisorEcf.tenantId, tenantId), eq(configuracionesEmisorEcf.empresaId, empresaId)))
      .limit(1);
    return config ?? null;
  }
}
