import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { punchListItems } from '../db/schema/obra/punch_list_item.js';

const zUUID = z.string().uuid();

export const zPunchListCreateDto = z.object({
  proyectoId: zUUID,
  descripcion: z.string().min(1),
  ubicacion: z.string().max(500).optional(),
  responsableId: zUUID.optional(),
  fechaLimite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const zPunchListActualizarEstadoDto = z.object({
  estado: z.enum(['EN_PROGRESO', 'COMPLETADO', 'RECHAZADO']),
  evidenciaArchivoId: zUUID.optional(),
});

export type PunchListCreateDto = z.infer<typeof zPunchListCreateDto>;
export type PunchListActualizarEstadoDto = z.infer<typeof zPunchListActualizarEstadoDto>;

@Injectable()
export class PunchListService {
  constructor(private readonly db: DbService) {}

  async crear(tenantId: string, dto: PunchListCreateDto, usuarioId: string) {
    const now = new Date();
    const id = newId();

    await this.db.tx.insert(punchListItems).values({
      id,
      tenantId,
      proyectoId: dto.proyectoId,
      descripcion: dto.descripcion,
      ...(dto.ubicacion ? { ubicacion: dto.ubicacion } : {}),
      ...(dto.responsableId ? { responsableId: dto.responsableId } : {}),
      ...(dto.fechaLimite ? { fechaLimite: dto.fechaLimite } : {}),
      estado: 'PENDIENTE',
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    });

    return id;
  }

  async actualizarEstado(
    tenantId: string,
    itemId: string,
    dto: PunchListActualizarEstadoDto,
    usuarioId: string,
  ) {
    const [item] = await this.db.tx
      .select()
      .from(punchListItems)
      .where(and(eq(punchListItems.tenantId, tenantId), eq(punchListItems.id, itemId)))
      .limit(1);

    if (!item) throw new NotFoundException(`Punch list item ${itemId} no encontrado`);
    if (item.estado === 'COMPLETADO') throw new BadRequestException('El ítem ya está completado');

    const now = new Date();
    const esFinal = dto.estado === 'COMPLETADO' || dto.estado === 'RECHAZADO';

    await this.db.tx
      .update(punchListItems)
      .set({
        estado: dto.estado,
        ...(dto.evidenciaArchivoId ? { evidenciaArchivoId: dto.evidenciaArchivoId } : {}),
        ...(esFinal ? { resueltoEn: now, resueltoPor: usuarioId } : {}),
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(punchListItems.id, itemId));
  }

  async findAll(tenantId: string, proyectoId?: string) {
    return this.db.tx
      .select()
      .from(punchListItems)
      .where(
        proyectoId
          ? and(eq(punchListItems.tenantId, tenantId), eq(punchListItems.proyectoId, proyectoId))
          : eq(punchListItems.tenantId, tenantId),
      );
  }

  async findById(tenantId: string, id: string) {
    const [item] = await this.db.tx
      .select()
      .from(punchListItems)
      .where(and(eq(punchListItems.tenantId, tenantId), eq(punchListItems.id, id)))
      .limit(1);
    if (!item) throw new NotFoundException(`Punch list item ${id} no encontrado`);
    return item;
  }
}
