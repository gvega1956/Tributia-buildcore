import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, asc } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { DbService } from '../database/db.service.js';
import { apus, apuLineas, type ApuInsert, type ApuLineaInsert, type ApuSelect, type ApuLineaSelect } from '../db/schema/proyectos/apu.js';
import { partidas } from '../db/schema/proyectos/partida.js';
import { newId } from '@tributia/shared';
import type {
  ApuCreateInput,
  ApuUpdateInput,
  ApuLineaCreateInput,
  ApuLineaUpdateInput,
} from '@tributia/proyectos';
import { ProyectoService } from './proyecto.service.js';

export interface ApuConLineas extends ApuSelect {
  lineas: ApuLineaSelect[];
}

@Injectable()
export class ApuService {
  constructor(
    private readonly db: DbService,
    private readonly proyectoService: ProyectoService,
  ) {}

  // ── APU de partida ────────────────────────────────────────────────────────

  async createParaPartida(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    partidaId: string,
    input: ApuCreateInput,
  ): Promise<ApuConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    await this.assertPartidaPertenece(tenantId, proyectoId, partidaId);

    // Verificar que no existe ya un APU para esta partida
    const [existing] = await this.db.tx
      .select({ id: apus.id })
      .from(apus)
      .where(and(eq(apus.partidaId, partidaId), isNull(apus.deletedAt)))
      .limit(1);
    if (existing) {
      throw new ConflictException(
        'Esta partida ya tiene un APU. Actualice las líneas del APU existente.',
      );
    }

    return this.createApuInternal(tenantId, usuarioId, { ...input, partidaId, esBiblioteca: false });
  }

  async findParaPartida(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    partidaId: string,
  ): Promise<ApuConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    return this.findApuByPartidaRaw(tenantId, partidaId);
  }

  async updateParaPartida(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    partidaId: string,
    input: ApuUpdateInput,
  ): Promise<ApuConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    const apu = await this.findApuByPartidaRaw(tenantId, partidaId);

    const [updated] = await this.db.tx
      .update(apus)
      .set({
        ...(input.nombre !== undefined && { nombre: input.nombre }),
        ...(input.descripcion !== undefined && { descripcion: input.descripcion ?? null }),
        ...(input.unidadMedidaId !== undefined && { unidadMedidaId: input.unidadMedidaId ?? null }),
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(apus.id, apu.id))
      .returning();

    const lineas = await this.findLineas(apu.id);
    return { ...updated!, lineas };
  }

  // ── Líneas del APU ────────────────────────────────────────────────────────

  async addLinea(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    partidaId: string,
    input: ApuLineaCreateInput,
  ): Promise<ApuConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    const apu = await this.findApuByPartidaRaw(tenantId, partidaId);

    const precioTotal = new Decimal(input.cantidad)
      .mul(new Decimal(input.precioUnitario))
      .toFixed(4);

    const lineaData: ApuLineaInsert = {
      id: newId(),
      tenantId,
      apuId: apu.id,
      tipo: input.tipo,
      insumoId: input.insumoId ?? null,
      equipoCatalogoId: input.equipoCatalogoId ?? null,
      descripcion: input.descripcion ?? null,
      cantidad: input.cantidad,
      precioUnitario: input.precioUnitario,
      precioTotal,
      moneda: input.moneda,
      orden: input.orden,
      createdAt: new Date(),
      createdBy: usuarioId,
      updatedAt: new Date(),
      updatedBy: usuarioId,
    };

    await this.db.tx.insert(apuLineas).values(lineaData);
    return this.recalcularYRetornar(tenantId, apu.id, usuarioId);
  }

  async updateLinea(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    partidaId: string,
    lineaId: string,
    input: ApuLineaUpdateInput,
  ): Promise<ApuConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    const apu = await this.findApuByPartidaRaw(tenantId, partidaId);

    const [linea] = await this.db.tx
      .select()
      .from(apuLineas)
      .where(and(eq(apuLineas.id, lineaId), eq(apuLineas.apuId, apu.id)))
      .limit(1);
    if (!linea) throw new NotFoundException(`Línea APU '${lineaId}' no encontrada.`);

    const newCantidad = input.cantidad ?? linea.cantidad;
    const newPrecioUnitario = input.precioUnitario ?? linea.precioUnitario;
    const precioTotal = new Decimal(newCantidad)
      .mul(new Decimal(newPrecioUnitario))
      .toFixed(4);

    await this.db.tx
      .update(apuLineas)
      .set({
        ...(input.tipo !== undefined && { tipo: input.tipo }),
        ...(input.insumoId !== undefined && { insumoId: input.insumoId ?? null }),
        ...(input.equipoCatalogoId !== undefined && { equipoCatalogoId: input.equipoCatalogoId ?? null }),
        ...(input.descripcion !== undefined && { descripcion: input.descripcion ?? null }),
        ...(input.cantidad !== undefined && { cantidad: input.cantidad }),
        ...(input.precioUnitario !== undefined && { precioUnitario: input.precioUnitario }),
        precioTotal,
        ...(input.orden !== undefined && { orden: input.orden }),
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(apuLineas.id, lineaId));

    return this.recalcularYRetornar(tenantId, apu.id, usuarioId);
  }

  async removeLinea(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    partidaId: string,
    lineaId: string,
  ): Promise<ApuConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    const apu = await this.findApuByPartidaRaw(tenantId, partidaId);

    const deleted = await this.db.tx
      .delete(apuLineas)
      .where(and(eq(apuLineas.id, lineaId), eq(apuLineas.apuId, apu.id)))
      .returning({ id: apuLineas.id });
    if (!deleted.length) throw new NotFoundException(`Línea APU '${lineaId}' no encontrada.`);

    return this.recalcularYRetornar(tenantId, apu.id, usuarioId);
  }

  // ── Biblioteca de APUs ────────────────────────────────────────────────────

  async createBiblioteca(
    tenantId: string,
    usuarioId: string,
    input: ApuCreateInput,
  ): Promise<ApuConLineas> {
    return this.createApuInternal(tenantId, usuarioId, { ...input, esBiblioteca: true, partidaId: null });
  }

  async findAllBiblioteca(tenantId: string): Promise<ApuSelect[]> {
    return this.db.tx
      .select()
      .from(apus)
      .where(
        and(
          eq(apus.tenantId, tenantId),
          eq(apus.esBiblioteca, true),
          eq(apus.activo, true),
          isNull(apus.deletedAt),
        ),
      )
      .orderBy(asc(apus.codigo), asc(apus.version));
  }

  async findBibliotecaById(tenantId: string, id: string): Promise<ApuConLineas> {
    const [row] = await this.db.tx
      .select()
      .from(apus)
      .where(
        and(
          eq(apus.id, id),
          eq(apus.tenantId, tenantId),
          eq(apus.esBiblioteca, true),
          isNull(apus.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException(`APU de biblioteca '${id}' no encontrado.`);
    const lineas = await this.findLineas(id);
    return { ...row, lineas };
  }

  async copiarBibliotecaAPartida(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    partidaId: string,
    apuBibliotecaId: string,
  ): Promise<ApuConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    await this.assertPartidaPertenece(tenantId, proyectoId, partidaId);

    const template = await this.findBibliotecaById(tenantId, apuBibliotecaId);

    // Verificar que no existe ya un APU para esta partida
    const [existing] = await this.db.tx
      .select({ id: apus.id })
      .from(apus)
      .where(and(eq(apus.partidaId, partidaId), isNull(apus.deletedAt)))
      .limit(1);
    if (existing) {
      throw new ConflictException(
        'Esta partida ya tiene un APU. Elimine el existente antes de copiar.',
      );
    }

    const newInput: ApuCreateInput = {
      codigo: template.codigo,
      nombre: template.nombre,
      descripcion: template.descripcion ?? undefined,
      unidadMedidaId: template.unidadMedidaId ?? undefined,
      moneda: template.moneda,
      esBiblioteca: false,
      lineas: template.lineas.map((l) => ({
        tipo: l.tipo,
        insumoId: l.insumoId ?? undefined,
        equipoCatalogoId: l.equipoCatalogoId ?? undefined,
        descripcion: l.descripcion ?? undefined,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        moneda: l.moneda,
        orden: l.orden,
      })),
    };

    return this.createApuInternal(tenantId, usuarioId, { ...newInput, partidaId, esBiblioteca: false });
  }

  // ── Helpers internos ──────────────────────────────────────────────────────

  private async createApuInternal(
    tenantId: string,
    usuarioId: string,
    data: ApuCreateInput & { partidaId?: string | null; esBiblioteca: boolean },
  ): Promise<ApuConLineas> {
    const now = new Date();

    // Calcular precio_unitario inicial si hay líneas
    let precioUnitario = new Decimal('0');
    const lineasConTotal = (data.lineas ?? []).map((l) => {
      const total = new Decimal(l.cantidad).mul(new Decimal(l.precioUnitario));
      precioUnitario = precioUnitario.plus(total);
      return { ...l, precioTotal: total.toFixed(4) };
    });

    const apuData: ApuInsert = {
      id: newId(),
      tenantId,
      partidaId: data.partidaId ?? null,
      esBiblioteca: data.esBiblioteca,
      codigo: data.codigo,
      nombre: data.nombre,
      descripcion: data.descripcion ?? null,
      version: 1,
      unidadMedidaId: data.unidadMedidaId ?? null,
      precioUnitario: precioUnitario.toFixed(4),
      moneda: data.moneda,
      activo: true,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };

    const [apu] = await this.db.tx.insert(apus).values(apuData).returning();

    if (lineasConTotal.length > 0) {
      await this.db.tx.insert(apuLineas).values(
        lineasConTotal.map((l) => ({
          id: newId(),
          tenantId,
          apuId: apu!.id,
          tipo: l.tipo,
          insumoId: l.insumoId ?? null,
          equipoCatalogoId: l.equipoCatalogoId ?? null,
          descripcion: l.descripcion ?? null,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          precioTotal: l.precioTotal,
          moneda: l.moneda,
          orden: l.orden,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        } satisfies ApuLineaInsert)),
      );
    }

    // Sync partida.precio_unitario
    if (data.partidaId) {
      await this.db.tx
        .update(partidas)
        .set({ precioUnitario: precioUnitario.toFixed(4), updatedAt: now, updatedBy: usuarioId })
        .where(eq(partidas.id, data.partidaId));
    }

    const lineas = await this.findLineas(apu!.id);
    return { ...apu!, lineas };
  }

  private async recalcularYRetornar(
    tenantId: string,
    apuId: string,
    usuarioId: string,
  ): Promise<ApuConLineas> {
    const lineas = await this.findLineas(apuId);

    const nuevo = lineas.reduce(
      (acc, l) => acc.plus(new Decimal(l.precioTotal)),
      new Decimal('0'),
    );

    const [apu] = await this.db.tx
      .update(apus)
      .set({ precioUnitario: nuevo.toFixed(4), updatedAt: new Date(), updatedBy: usuarioId })
      .where(eq(apus.id, apuId))
      .returning();

    // Sync partida.precio_unitario si el APU está ligado a una partida
    if (apu!.partidaId) {
      await this.db.tx
        .update(partidas)
        .set({ precioUnitario: nuevo.toFixed(4), updatedAt: new Date(), updatedBy: usuarioId })
        .where(eq(partidas.id, apu!.partidaId));
    }

    return { ...apu!, lineas };
  }

  private async findLineas(apuId: string): Promise<ApuLineaSelect[]> {
    return this.db.tx
      .select()
      .from(apuLineas)
      .where(eq(apuLineas.apuId, apuId))
      .orderBy(asc(apuLineas.orden));
  }

  private async findApuByPartidaRaw(tenantId: string, partidaId: string): Promise<ApuConLineas> {
    const [row] = await this.db.tx
      .select()
      .from(apus)
      .where(
        and(
          eq(apus.partidaId, partidaId),
          eq(apus.tenantId, tenantId),
          isNull(apus.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException(`La partida '${partidaId}' no tiene APU definido.`);
    }
    const lineas = await this.findLineas(row.id);
    return { ...row, lineas };
  }

  private async assertPartidaPertenece(
    tenantId: string,
    proyectoId: string,
    partidaId: string,
  ): Promise<void> {
    const [row] = await this.db.tx
      .select({ id: partidas.id })
      .from(partidas)
      .where(
        and(
          eq(partidas.id, partidaId),
          eq(partidas.tenantId, tenantId),
          eq(partidas.proyectoId, proyectoId),
          eq(partidas.activo, true),
          isNull(partidas.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException(`Partida '${partidaId}' no encontrada en el proyecto.`);
    }
  }
}
