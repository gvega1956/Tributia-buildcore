import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import {
  equiposCatalogo,
  type EquipoCatalogoInsert,
  type EquipoCatalogoSelect,
} from '../db/schema/catalogos/equipo_catalogo.js';
import type { EquipoCatalogoCreateInput, EquipoCatalogoUpdateInput } from '@tributia/catalogos';
import { newId } from '@tributia/shared';

@Injectable()
export class EquipoCatalogoService {
  constructor(private readonly db: DbService) {}

  async create(
    tenantId: string,
    usuarioId: string,
    input: EquipoCatalogoCreateInput,
  ): Promise<EquipoCatalogoSelect> {
    const now = new Date();
    const data: EquipoCatalogoInsert = {
      id: newId(),
      tenantId,
      codigo: input.codigo,
      nombre: input.nombre,
      descripcion: input.descripcion ?? null,
      categoria: input.categoria,
      tarifaHoraria: input.tarifaHoraria,
      monedaTarifa: input.monedaTarifa,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };
    try {
      const [row] = await this.db.tx.insert(equiposCatalogo).values(data).returning();
      return row!;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException(
          `Ya existe un equipo con código '${input.codigo}' en este tenant.`,
        );
      }
      throw err;
    }
  }

  async findAll(tenantId: string): Promise<EquipoCatalogoSelect[]> {
    return this.db.tx
      .select()
      .from(equiposCatalogo)
      .where(
        and(
          eq(equiposCatalogo.tenantId, tenantId),
          eq(equiposCatalogo.activo, true),
          isNull(equiposCatalogo.deletedAt),
        ),
      )
      .orderBy(equiposCatalogo.codigo);
  }

  async findById(id: string): Promise<EquipoCatalogoSelect> {
    const [row] = await this.db.tx
      .select()
      .from(equiposCatalogo)
      .where(and(eq(equiposCatalogo.id, id), isNull(equiposCatalogo.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException(`Equipo '${id}' no encontrado.`);
    return row;
  }

  async update(
    id: string,
    usuarioId: string,
    input: EquipoCatalogoUpdateInput,
  ): Promise<EquipoCatalogoSelect> {
    await this.findById(id);
    const [row] = await this.db.tx
      .update(equiposCatalogo)
      .set({
        ...(input.nombre !== undefined && { nombre: input.nombre }),
        ...(input.categoria !== undefined && { categoria: input.categoria }),
        ...(input.tarifaHoraria !== undefined && { tarifaHoraria: input.tarifaHoraria }),
        ...(input.monedaTarifa !== undefined && { monedaTarifa: input.monedaTarifa }),
        ...(input.descripcion !== undefined && { descripcion: input.descripcion ?? null }),
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(equiposCatalogo.id, id))
      .returning();
    return row!;
  }
}
