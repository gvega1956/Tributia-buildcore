import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type { SocCreateInput } from '@tributia/compras';
import { DbService } from '../database/db.service.js';
import {
  solicitudesCotizacion,
  lineasSoc,
  socProveedores,
} from '../db/schema/compras/solicitud_cotizacion.js';
import { lineasRequisicion, requisiciones } from '../db/schema/compras/requisicion.js';

@Injectable()
export class SolicitudCotizacionService {
  constructor(private readonly db: DbService) {}

  /**
   * Crea una Solicitud de Cotización consolidando líneas de requisiciones aprobadas.
   */
  async create(tenantId: string, usuarioId: string, input: SocCreateInput) {
    const now = new Date();
    const numero = `SOC-${Date.now()}`;

    // Verificar que las líneas pertenecen a requisiciones APROBADAS del tenant
    const lineas = await this.db.tx
      .select({
        linea: lineasRequisicion,
        req: requisiciones,
      })
      .from(lineasRequisicion)
      .innerJoin(requisiciones, eq(lineasRequisicion.requisicionId, requisiciones.id))
      .where(
        and(
          eq(lineasRequisicion.tenantId, tenantId),
          inArray(lineasRequisicion.id, input.lineaRequisicionIds),
        ),
      );

    if (lineas.length !== input.lineaRequisicionIds.length) {
      throw new NotFoundException('Una o más líneas de requisición no encontradas en este tenant.');
    }

    const lineasNoAprobadas = lineas.filter((l) => l.req.estado !== 'APROBADA');
    if (lineasNoAprobadas.length > 0) {
      throw new BadRequestException(
        `Solo se pueden consolidar líneas de requisiciones APROBADAS. ` +
        `Líneas no aprobadas: ${lineasNoAprobadas.map((l) => l.linea.id).join(', ')}`,
      );
    }

    try {
      const [soc] = await this.db.tx
        .insert(solicitudesCotizacion)
        .values({
          id: newId(),
          tenantId,
          empresaId: input.empresaId,
          numero,
          estado: 'BORRADOR',
          fechaVencimiento: input.fechaVencimiento ?? null,
          notas: input.notas ?? null,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        })
        .returning();

      // Insertar líneas SOC
      for (const lineaReqId of input.lineaRequisicionIds) {
        const lineaData = lineas.find((l) => l.linea.id === lineaReqId)!;
        await this.db.tx.insert(lineasSoc).values({
          id: newId(),
          tenantId,
          socId: soc!.id,
          lineaRequisicionId: lineaReqId,
          cantidad: lineaData.linea.cantidad,
          unidadMedida: lineaData.linea.unidadMedida,
          descripcion: lineaData.linea.descripcion,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        });
      }

      // Registrar proveedores destinatarios
      for (const terceroId of input.terceroIds) {
        await this.db.tx.insert(socProveedores).values({
          id: newId(),
          tenantId,
          socId: soc!.id,
          terceroId,
          enviadaEn: null,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        });
      }

      // Marcar las requisiciones incluidas como CONSOLIDADAS
      const reqIds = [...new Set(lineas.map((l) => l.req.id))];
      for (const reqId of reqIds) {
        await this.db.tx
          .update(requisiciones)
          .set({ estado: 'CONSOLIDADA', updatedAt: now, updatedBy: usuarioId })
          .where(eq(requisiciones.id, reqId));
      }

      return soc!;
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) throw new ConflictException('Conflicto al crear SOC.');
      throw err;
    }
  }

  async enviar(tenantId: string, usuarioId: string, id: string) {
    const [soc] = await this.db.tx
      .select()
      .from(solicitudesCotizacion)
      .where(and(eq(solicitudesCotizacion.tenantId, tenantId), eq(solicitudesCotizacion.id, id)))
      .limit(1);

    if (!soc) throw new NotFoundException(`SOC ${id} no encontrada.`);
    if (soc.estado !== 'BORRADOR') {
      throw new BadRequestException(`Solo se puede enviar una SOC en estado BORRADOR. Estado actual: ${soc.estado}`);
    }

    const now = new Date();

    // Marcar proveedores como enviados
    await this.db.tx
      .update(socProveedores)
      .set({ enviadaEn: now, updatedAt: now, updatedBy: usuarioId })
      .where(eq(socProveedores.socId, id));

    const [updated] = await this.db.tx
      .update(solicitudesCotizacion)
      .set({ estado: 'ENVIADA', updatedAt: now, updatedBy: usuarioId })
      .where(eq(solicitudesCotizacion.id, id))
      .returning();

    return updated!;
  }

  async findAll(tenantId: string) {
    return this.db.tx
      .select()
      .from(solicitudesCotizacion)
      .where(
        and(
          eq(solicitudesCotizacion.tenantId, tenantId),
          isNull(solicitudesCotizacion.deletedAt),
        ),
      );
  }

  async findById(tenantId: string, id: string) {
    const [soc] = await this.db.tx
      .select()
      .from(solicitudesCotizacion)
      .where(and(eq(solicitudesCotizacion.tenantId, tenantId), eq(solicitudesCotizacion.id, id)))
      .limit(1);

    if (!soc) throw new NotFoundException(`SOC ${id} no encontrada.`);

    const lineas = await this.db.tx.select().from(lineasSoc).where(eq(lineasSoc.socId, id));
    const proveedores = await this.db.tx
      .select()
      .from(socProveedores)
      .where(eq(socProveedores.socId, id));

    return { ...soc, lineas, proveedores };
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    );
  }
}
