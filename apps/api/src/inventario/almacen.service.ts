import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { almacenes, ubicaciones } from '../db/schema/inventario/almacen.js';
import type {
  AlmacenCreateInput,
  AlmacenUpdateInput,
  UbicacionCreateInput,
} from '@tributia/inventario';

@Injectable()
export class AlmacenService {
  constructor(private readonly db: DbService) {}

  async create(tenantId: string, usuarioId: string, input: AlmacenCreateInput) {
    const now = new Date();
    try {
      const [row] = await this.db.tx
        .insert(almacenes)
        .values({
          id: newId(),
          tenantId,
          empresaId: input.empresaId,
          proyectoId: input.proyectoId ?? null,
          tipo: input.tipo,
          codigo: input.codigo,
          nombre: input.nombre,
          ubicacionFisica: input.ubicacionFisica ?? null,
          activo: true,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        })
        .returning();
      return row!;
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(`Ya existe un almacén con código '${input.codigo}' en este tenant.`);
      }
      throw err;
    }
  }

  async findAll(tenantId: string, empresaId?: string) {
    return this.db.tx
      .select()
      .from(almacenes)
      .where(
        and(
          eq(almacenes.tenantId, tenantId),
          empresaId ? eq(almacenes.empresaId, empresaId) : undefined,
          isNull(almacenes.deletedAt),
        ),
      );
  }

  async findById(tenantId: string, id: string) {
    const [row] = await this.db.tx
      .select()
      .from(almacenes)
      .where(and(eq(almacenes.tenantId, tenantId), eq(almacenes.id, id), isNull(almacenes.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException(`Almacén ${id} no encontrado.`);
    return row;
  }

  async update(tenantId: string, usuarioId: string, id: string, input: AlmacenUpdateInput) {
    await this.findById(tenantId, id);
    const [row] = await this.db.tx
      .update(almacenes)
      .set({
        ...(input.nombre !== undefined && { nombre: input.nombre }),
        ...(input.ubicacionFisica !== undefined && { ubicacionFisica: input.ubicacionFisica }),
        ...(input.activo !== undefined && { activo: input.activo }),
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(and(eq(almacenes.tenantId, tenantId), eq(almacenes.id, id)))
      .returning();
    return row!;
  }

  async addUbicacion(tenantId: string, usuarioId: string, almacenId: string, input: UbicacionCreateInput) {
    await this.findById(tenantId, almacenId);
    const now = new Date();
    try {
      const [row] = await this.db.tx
        .insert(ubicaciones)
        .values({
          id: newId(),
          tenantId,
          almacenId,
          codigo: input.codigo,
          nombre: input.nombre,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        })
        .returning();
      return row!;
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(`Ya existe una ubicación con código '${input.codigo}' en este almacén.`);
      }
      throw err;
    }
  }

  async findUbicaciones(tenantId: string, almacenId: string) {
    return this.db.tx
      .select()
      .from(ubicaciones)
      .where(and(eq(ubicaciones.tenantId, tenantId), eq(ubicaciones.almacenId, almacenId)));
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
