import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { terceros, type TerceroInsert, type TerceroSelect } from '../db/schema/catalogos/tercero.js';
import type { TerceroCreateInput, TerceroUpdateInput } from '@tributia/catalogos';
import { newId } from '@tributia/shared';

@Injectable()
export class TerceroService {
  constructor(private readonly db: DbService) {}

  async create(
    tenantId: string,
    usuarioId: string,
    input: TerceroCreateInput,
  ): Promise<TerceroSelect> {
    const now = new Date();
    const data: TerceroInsert = {
      id: newId(),
      tenantId,
      tipoIdentificacion: input.tipoIdentificacion,
      rncCedula: input.rncCedula,
      nombreComercial: input.nombreComercial,
      nombreLegal: input.nombreLegal ?? null,
      tipoContribuyente: input.tipoContribuyente,
      condicionDgii: input.condicionDgii,
      esCliente: input.esCliente,
      esProveedor: input.esProveedor,
      esSubcontratista: input.esSubcontratista,
      esEmpleadoRelacionado: input.esEmpleadoRelacionado,
      esBanco: input.esBanco,
      esInstitucionEstatal: input.esInstitucionEstatal,
      retencionIsrPct: input.retencionIsrPct ?? null,
      retencionItbisPct: input.retencionItbisPct ?? null,
      email: input.email ?? null,
      telefono: input.telefono ?? null,
      direccion: input.direccion ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };

    try {
      const [row] = await this.db.tx.insert(terceros).values(data).returning();
      return row!;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException(
          `Ya existe un tercero con RNC/Cédula '${input.rncCedula}' en este tenant.`,
        );
      }
      throw err;
    }
  }

  async findAll(tenantId: string): Promise<TerceroSelect[]> {
    return this.db.tx
      .select()
      .from(terceros)
      .where(and(eq(terceros.tenantId, tenantId), eq(terceros.activo, true), isNull(terceros.deletedAt)))
      .orderBy(terceros.nombreComercial);
  }

  async findById(id: string): Promise<TerceroSelect> {
    const [row] = await this.db.tx
      .select()
      .from(terceros)
      .where(and(eq(terceros.id, id), isNull(terceros.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException(`Tercero '${id}' no encontrado.`);
    return row;
  }

  async update(
    id: string,
    usuarioId: string,
    input: TerceroUpdateInput,
  ): Promise<TerceroSelect> {
    await this.findById(id);

    const [row] = await this.db.tx
      .update(terceros)
      .set({
        ...(input.tipoIdentificacion !== undefined && { tipoIdentificacion: input.tipoIdentificacion }),
        ...(input.nombreComercial !== undefined && { nombreComercial: input.nombreComercial }),
        ...(input.tipoContribuyente !== undefined && { tipoContribuyente: input.tipoContribuyente }),
        ...(input.condicionDgii !== undefined && { condicionDgii: input.condicionDgii }),
        ...(input.esCliente !== undefined && { esCliente: input.esCliente }),
        ...(input.esProveedor !== undefined && { esProveedor: input.esProveedor }),
        ...(input.esSubcontratista !== undefined && { esSubcontratista: input.esSubcontratista }),
        ...(input.esEmpleadoRelacionado !== undefined && { esEmpleadoRelacionado: input.esEmpleadoRelacionado }),
        ...(input.esBanco !== undefined && { esBanco: input.esBanco }),
        ...(input.esInstitucionEstatal !== undefined && { esInstitucionEstatal: input.esInstitucionEstatal }),
        ...(input.nombreLegal !== undefined && { nombreLegal: input.nombreLegal ?? null }),
        ...(input.retencionIsrPct !== undefined && { retencionIsrPct: input.retencionIsrPct ?? null }),
        ...(input.retencionItbisPct !== undefined && { retencionItbisPct: input.retencionItbisPct ?? null }),
        ...(input.email !== undefined && { email: input.email ?? null }),
        ...(input.telefono !== undefined && { telefono: input.telefono ?? null }),
        ...(input.direccion !== undefined && { direccion: input.direccion ?? null }),
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(terceros.id, id))
      .returning();

    return row!;
  }

  async softDelete(id: string, usuarioId: string): Promise<void> {
    await this.findById(id);
    await this.db.tx
      .update(terceros)
      .set({ deletedAt: new Date(), deletedBy: usuarioId, activo: false, updatedAt: new Date(), updatedBy: usuarioId })
      .where(eq(terceros.id, id));
  }
}
