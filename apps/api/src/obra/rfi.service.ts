import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { rfis } from '../db/schema/obra/rfi.js';

const zUUID = z.string().uuid();

export const zRfiCreateDto = z.object({
  proyectoId: zUUID,
  titulo: z.string().min(1).max(500),
  descripcion: z.string().min(1),
  impacto: z.enum(['NINGUNO', 'DIAS', 'COSTO', 'AMBOS']).default('NINGUNO'),
  impactoDias: z.number().int().positive().optional(),
  impactoMonto: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  asignadoA: zUUID.optional(),
  fechaLimite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const zRfiResponderDto = z.object({
  respuesta: z.string().min(1),
});

export type RfiCreateDto = z.infer<typeof zRfiCreateDto>;
export type RfiResponderDto = z.infer<typeof zRfiResponderDto>;

@Injectable()
export class RfiService {
  constructor(private readonly db: DbService) {}

  async crear(tenantId: string, dto: RfiCreateDto, usuarioId: string) {
    const now = new Date();

    // Número secuencial por proyecto
    const countResult = await this.db.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(rfis)
      .where(and(eq(rfis.tenantId, tenantId), eq(rfis.proyectoId, dto.proyectoId)));

    const numero = (countResult[0]?.count ?? 0) + 1;
    const id = newId();

    await this.db.tx.insert(rfis).values({
      id,
      tenantId,
      proyectoId: dto.proyectoId,
      numero,
      titulo: dto.titulo,
      descripcion: dto.descripcion,
      impacto: dto.impacto,
      ...(dto.impactoDias != null ? { impactoDias: dto.impactoDias } : {}),
      ...(dto.impactoMonto ? { impactoMonto: dto.impactoMonto } : {}),
      ...(dto.asignadoA ? { asignadoA: dto.asignadoA } : {}),
      ...(dto.fechaLimite ? { fechaLimite: dto.fechaLimite } : {}),
      estado: 'ABIERTO',
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    });

    return id;
  }

  async responder(tenantId: string, rfiId: string, dto: RfiResponderDto, usuarioId: string) {
    const [rfi] = await this.db.tx
      .select()
      .from(rfis)
      .where(and(eq(rfis.tenantId, tenantId), eq(rfis.id, rfiId)))
      .limit(1);

    if (!rfi) throw new NotFoundException(`RFI ${rfiId} no encontrado`);
    if (rfi.estado === 'CERRADO') throw new BadRequestException('El RFI ya está cerrado');

    const now = new Date();
    await this.db.tx
      .update(rfis)
      .set({
        respuesta: dto.respuesta,
        fechaRespuesta: now.toISOString().slice(0, 10),
        respondidoPor: usuarioId,
        estado: 'RESPONDIDO',
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(rfis.id, rfiId));
  }

  async cerrar(tenantId: string, rfiId: string, usuarioId: string) {
    const [rfi] = await this.db.tx
      .select()
      .from(rfis)
      .where(and(eq(rfis.tenantId, tenantId), eq(rfis.id, rfiId)))
      .limit(1);

    if (!rfi) throw new NotFoundException(`RFI ${rfiId} no encontrado`);
    if (rfi.estado === 'CERRADO') return; // idempotente

    const now = new Date();
    await this.db.tx
      .update(rfis)
      .set({
        estado: 'CERRADO',
        cerradoEn: now,
        cerradoPor: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(rfis.id, rfiId));
  }

  async findAll(tenantId: string, proyectoId?: string) {
    return this.db.tx
      .select()
      .from(rfis)
      .where(
        proyectoId
          ? and(eq(rfis.tenantId, tenantId), eq(rfis.proyectoId, proyectoId))
          : eq(rfis.tenantId, tenantId),
      );
  }

  async findById(tenantId: string, id: string) {
    const [rfi] = await this.db.tx
      .select()
      .from(rfis)
      .where(and(eq(rfis.tenantId, tenantId), eq(rfis.id, id)))
      .limit(1);
    if (!rfi) throw new NotFoundException(`RFI ${id} no encontrado`);
    return rfi;
  }
}
