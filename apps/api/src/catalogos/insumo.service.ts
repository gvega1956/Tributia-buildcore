import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import {
  unidadesMedida,
  type UnidadMedidaInsert,
  type UnidadMedidaSelect,
} from '../db/schema/catalogos/unidad_medida.js';
import {
  insumos,
  insumosEquivalencia,
  type InsumoInsert,
  type InsumoSelect,
  type InsumoEquivalenciaInsert,
  type InsumoEquivalenciaSelect,
} from '../db/schema/catalogos/insumo.js';
import type {
  UnidadMedidaCreateInput,
  InsumoCreateInput,
  InsumoUpdateInput,
  EquivalenciaCreateInput,
} from '@tributia/catalogos';
import { newId } from '@tributia/shared';

@Injectable()
export class InsumoService {
  constructor(private readonly db: DbService) {}

  // ── Unidades de medida ─────────────────────────────────────────────────────

  async createUnidad(
    tenantId: string,
    usuarioId: string,
    input: UnidadMedidaCreateInput,
  ): Promise<UnidadMedidaSelect> {
    const now = new Date();
    const data: UnidadMedidaInsert = {
      id: newId(),
      tenantId,
      codigo: input.codigo,
      nombre: input.nombre,
      descripcion: input.descripcion ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };
    try {
      const [row] = await this.db.tx.insert(unidadesMedida).values(data).returning();
      return row!;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException(
          `Ya existe una unidad de medida con código '${input.codigo}' en este tenant.`,
        );
      }
      throw err;
    }
  }

  async listUnidades(tenantId: string): Promise<UnidadMedidaSelect[]> {
    return this.db.tx
      .select()
      .from(unidadesMedida)
      .where(and(eq(unidadesMedida.tenantId, tenantId), eq(unidadesMedida.activo, true)))
      .orderBy(unidadesMedida.codigo);
  }

  // ── Insumos ────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    usuarioId: string,
    input: InsumoCreateInput,
  ): Promise<InsumoSelect> {
    const now = new Date();
    const data: InsumoInsert = {
      id: newId(),
      tenantId,
      codigo: input.codigo,
      nombre: input.nombre,
      descripcion: input.descripcion ?? null,
      unidadId: input.unidadId,
      categoria: input.categoria,
      codigoDgii: input.codigoDgii ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };
    try {
      const [row] = await this.db.tx.insert(insumos).values(data).returning();
      return row!;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException(
          `Ya existe un insumo con código '${input.codigo}' en este tenant.`,
        );
      }
      throw err;
    }
  }

  async findAll(tenantId: string): Promise<InsumoSelect[]> {
    return this.db.tx
      .select()
      .from(insumos)
      .where(and(eq(insumos.tenantId, tenantId), eq(insumos.activo, true), isNull(insumos.deletedAt)))
      .orderBy(insumos.codigo);
  }

  async findById(id: string): Promise<InsumoSelect> {
    const [row] = await this.db.tx
      .select()
      .from(insumos)
      .where(and(eq(insumos.id, id), isNull(insumos.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException(`Insumo '${id}' no encontrado.`);
    return row;
  }

  async update(
    id: string,
    usuarioId: string,
    input: InsumoUpdateInput,
  ): Promise<InsumoSelect> {
    await this.findById(id);
    const [row] = await this.db.tx
      .update(insumos)
      .set({
        ...(input.nombre !== undefined && { nombre: input.nombre }),
        ...(input.unidadId !== undefined && { unidadId: input.unidadId }),
        ...(input.categoria !== undefined && { categoria: input.categoria }),
        ...(input.descripcion !== undefined && { descripcion: input.descripcion ?? null }),
        ...(input.codigoDgii !== undefined && { codigoDgii: input.codigoDgii ?? null }),
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(insumos.id, id))
      .returning();
    return row!;
  }

  async addEquivalencia(
    insumoId: string,
    tenantId: string,
    usuarioId: string,
    input: EquivalenciaCreateInput,
  ): Promise<InsumoEquivalenciaSelect> {
    await this.findById(insumoId);
    const data: InsumoEquivalenciaInsert = {
      id: newId(),
      tenantId,
      insumoId,
      unidadOrigenId: input.unidadOrigenId,
      factor: input.factor,
      unidadDestinoId: input.unidadDestinoId,
      createdBy: usuarioId,
      updatedBy: usuarioId,
    };
    try {
      const [row] = await this.db.tx.insert(insumosEquivalencia).values(data).returning();
      return row!;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException('Ya existe una equivalencia para ese par de unidades en este insumo.');
      }
      throw err;
    }
  }
}
