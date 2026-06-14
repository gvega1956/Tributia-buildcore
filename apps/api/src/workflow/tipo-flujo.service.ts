import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { tiposFlujo, type TipoFlujoInsert, type TipoFlujoSelect } from '../db/schema/workflow/tipo_flujo.js';
import { pasosFlujo, type PasoFlujoInsert, type PasoFlujoSelect } from '../db/schema/workflow/paso_flujo.js';
import type { CrearTipoFlujoInput, AgregarPasoFlujoInput } from '@tributia/workflow';
import { newId } from '@tributia/shared';
import Decimal from 'decimal.js';

@Injectable()
export class TipoFlujoService {
  constructor(private readonly db: DbService) {}

  async crearTipoFlujo(
    tenantId: string,
    usuarioId: string,
    input: CrearTipoFlujoInput,
  ): Promise<TipoFlujoSelect> {
    const now = new Date();
    const data: TipoFlujoInsert = {
      id: newId(),
      tenantId,
      tipoDocumento: input.tipoDocumento,
      nombre: input.nombre,
      descripcion: input.descripcion ?? null,
      condicionMontoMin: input.condicionMontoMin ?? null,
      condicionMontoMax: input.condicionMontoMax ?? null,
      monedaCondicion: input.monedaCondicion ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };
    const [row] = await this.db.tx.insert(tiposFlujo).values(data).returning();
    return row!;
  }

  async agregarPaso(
    tipoFlujoId: string,
    tenantId: string,
    usuarioId: string,
    input: AgregarPasoFlujoInput,
  ): Promise<PasoFlujoSelect> {
    await this.findTipoFlujoById(tipoFlujoId);
    const now = new Date();
    const data: PasoFlujoInsert = {
      id: newId(),
      tenantId,
      tipoFlujoId,
      orden: input.orden,
      nombre: input.nombre,
      tipoAprobador: input.tipoAprobador,
      aprobadorId: input.aprobadorId,
      permiteDelegacion: input.permiteDelegacion,
      vencimientoHoras: input.vencimientoHoras ?? null,
      escalacionAprobadorId: input.escalacionAprobadorId ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };
    const [row] = await this.db.tx.insert(pasosFlujo).values(data).returning();
    return row!;
  }

  async findTipoFlujoById(id: string): Promise<TipoFlujoSelect> {
    const [row] = await this.db.tx
      .select()
      .from(tiposFlujo)
      .where(eq(tiposFlujo.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`TipoFlujo '${id}' no encontrado.`);
    return row;
  }

  async listByTenant(tenantId: string): Promise<TipoFlujoSelect[]> {
    return this.db.tx
      .select()
      .from(tiposFlujo)
      .where(and(eq(tiposFlujo.tenantId, tenantId), eq(tiposFlujo.activo, true)))
      .orderBy(tiposFlujo.tipoDocumento, tiposFlujo.nombre);
  }

  async listPasos(tipoFlujoId: string): Promise<PasoFlujoSelect[]> {
    return this.db.tx
      .select()
      .from(pasosFlujo)
      .where(and(eq(pasosFlujo.tipoFlujoId, tipoFlujoId), eq(pasosFlujo.activo, true)))
      .orderBy(pasosFlujo.orden, pasosFlujo.createdAt);
  }

  /**
   * Encuentra el tipo_flujo más adecuado para un documento dado su tipo y monto.
   * Prioriza el flujo con condición de monto más específica sobre el genérico.
   */
  async resolverTipoFlujo(
    tenantId: string,
    tipoDocumento: string,
    monto: string | null,
  ): Promise<TipoFlujoSelect | null> {
    const candidatos = await this.db.tx
      .select()
      .from(tiposFlujo)
      .where(
        and(
          eq(tiposFlujo.tenantId, tenantId),
          eq(tiposFlujo.tipoDocumento, tipoDocumento),
          eq(tiposFlujo.activo, true),
        ),
      );

    if (candidatos.length === 0) return null;

    const montoDecimal = monto ? new Decimal(monto) : null;

    // Candidatos con condición de monto (más específicos)
    const conCondicion = candidatos.filter((c) => {
      if (c.condicionMontoMin === null && c.condicionMontoMax === null) return false;
      if (!montoDecimal) return false;
      const minOk = c.condicionMontoMin === null || montoDecimal.gte(new Decimal(c.condicionMontoMin));
      const maxOk = c.condicionMontoMax === null || montoDecimal.lte(new Decimal(c.condicionMontoMax));
      return minOk && maxOk;
    });

    if (conCondicion.length > 0) return conCondicion[0]!;

    // Flujo genérico (sin condición de monto)
    const generico = candidatos.find(
      (c) => c.condicionMontoMin === null && c.condicionMontoMax === null,
    );
    return generico ?? null;
  }
}
