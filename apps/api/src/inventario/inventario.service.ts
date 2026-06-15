import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { stockAlmacen } from '../db/schema/inventario/stock_almacen.js';
import { movimientosInventario } from '../db/schema/inventario/movimiento_inventario.js';
import { conteosFisicos, lineasConteoFisico } from '../db/schema/inventario/conteo_fisico.js';
import { herramientasAsignadas } from '../db/schema/inventario/conteo_fisico.js';
import type {
  ConteoFisicoCreateInput,
  LineaConteoCreateInput,
} from '@tributia/inventario';

@Injectable()
export class InventarioService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  // ── Stock ──────────────────────────────────────────────────────────────────

  async getStock(tenantId: string, almacenId: string, insumoId?: string) {
    const conditions = [
      eq(stockAlmacen.tenantId, tenantId),
      eq(stockAlmacen.almacenId, almacenId),
    ];
    if (insumoId) conditions.push(eq(stockAlmacen.insumoId, insumoId));
    return this.db.tx.select().from(stockAlmacen).where(and(...conditions));
  }

  async getKardex(tenantId: string, almacenId: string, insumoId: string) {
    return this.db.tx
      .select()
      .from(movimientosInventario)
      .where(
        and(
          eq(movimientosInventario.tenantId, tenantId),
          eq(movimientosInventario.almacenId, almacenId),
          eq(movimientosInventario.insumoId, insumoId),
        ),
      )
      .orderBy(desc(movimientosInventario.createdAt));
  }

  async getMovimientos(tenantId: string, almacenId?: string) {
    const conditions = [eq(movimientosInventario.tenantId, tenantId)];
    if (almacenId) conditions.push(eq(movimientosInventario.almacenId, almacenId));
    return this.db.tx
      .select()
      .from(movimientosInventario)
      .where(and(...conditions))
      .orderBy(desc(movimientosInventario.createdAt));
  }

  // ── Conteo físico ──────────────────────────────────────────────────────────

  async createConteo(tenantId: string, usuarioId: string, input: ConteoFisicoCreateInput) {
    const now = new Date();
    const [row] = await this.db.tx
      .insert(conteosFisicos)
      .values({
        id: newId(),
        tenantId,
        empresaId: input.empresaId,
        almacenId: input.almacenId,
        fechaConteo: input.fechaConteo,
        estado: 'BORRADOR',
        responsableId: usuarioId,
        notas: input.notas ?? null,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();
    return row!;
  }

  async addLineaConteo(
    tenantId: string,
    usuarioId: string,
    conteoId: string,
    input: LineaConteoCreateInput,
  ) {
    const [conteo] = await this.db.tx
      .select()
      .from(conteosFisicos)
      .where(and(eq(conteosFisicos.tenantId, tenantId), eq(conteosFisicos.id, conteoId)))
      .limit(1);
    if (!conteo) throw new NotFoundException(`Conteo ${conteoId} no encontrado.`);
    if (conteo.estado !== 'BORRADOR') {
      throw new UnprocessableEntityException('Solo se pueden agregar líneas a conteos en BORRADOR.');
    }

    // Obtener cantidad del sistema actual
    const [stock] = await this.db.tx
      .select()
      .from(stockAlmacen)
      .where(
        and(
          eq(stockAlmacen.tenantId, tenantId),
          eq(stockAlmacen.almacenId, conteo.almacenId),
          eq(stockAlmacen.insumoId, input.insumoId),
        ),
      )
      .limit(1);

    const cantidadSistema = stock?.cantidad ?? '0.0000';
    const now = new Date();

    const [row] = await this.db.tx
      .insert(lineasConteoFisico)
      .values({
        id: newId(),
        tenantId,
        conteoId,
        insumoId: input.insumoId,
        cantidadSistema,
        cantidadFisica: input.cantidadFisica,
        costoUnitario: input.costoUnitario,
        moneda: input.moneda ?? 'DOP',
        ajusteGenerado: false,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();
    return row!;
  }

  async finalizarConteo(
    tenantId: string,
    usuarioId: string,
    conteoId: string,
    ctx: { empresaId: string; proyectoId?: string; centroCostoId?: string },
  ) {
    const [conteo] = await this.db.tx
      .select()
      .from(conteosFisicos)
      .where(and(eq(conteosFisicos.tenantId, tenantId), eq(conteosFisicos.id, conteoId)))
      .limit(1);
    if (!conteo) throw new NotFoundException(`Conteo ${conteoId} no encontrado.`);
    if (conteo.estado !== 'BORRADOR') {
      throw new UnprocessableEntityException('Solo se pueden finalizar conteos en BORRADOR.');
    }

    const lineas = await this.db.tx
      .select()
      .from(lineasConteoFisico)
      .where(and(eq(lineasConteoFisico.tenantId, tenantId), eq(lineasConteoFisico.conteoId, conteoId)));

    // Emitir evento ajuste_inventario por cada línea con diferencia
    for (const linea of lineas) {
      await this.ledger.append({
        tenantId,
        empresaId: ctx.empresaId,
        proyectoId: ctx.proyectoId ?? null,
        centroCostoId: ctx.centroCostoId ?? null,
        tipoEvento: 'ajuste_inventario',
        usuarioId,
        payload: {
          almacenId: conteo.almacenId,
          insumoId: linea.insumoId,
          cantidadSistema: linea.cantidadSistema,
          cantidadFisica: linea.cantidadFisica,
          unidad: 'UND',
          motivo: 'CONTEO_FISICO',
          costoUnitario: {
            amount: linea.costoUnitario,
            currency: linea.moneda,
          },
        },
        referenciaId: conteoId,
        referenciaTabla: 'conteo_fisico',
        idempotencyKey: `ajuste:${conteoId}:${linea.insumoId}`,
      });

      await this.db.tx
        .update(lineasConteoFisico)
        .set({ ajusteGenerado: true, updatedAt: new Date(), updatedBy: usuarioId })
        .where(eq(lineasConteoFisico.id, linea.id));
    }

    const [updated] = await this.db.tx
      .update(conteosFisicos)
      .set({ estado: 'FINALIZADO', updatedAt: new Date(), updatedBy: usuarioId })
      .where(and(eq(conteosFisicos.tenantId, tenantId), eq(conteosFisicos.id, conteoId)))
      .returning();

    return updated!;
  }

  async findConteos(tenantId: string, almacenId?: string) {
    const conditions = [
      eq(conteosFisicos.tenantId, tenantId),
      isNull(conteosFisicos.deletedAt),
    ];
    if (almacenId) conditions.push(eq(conteosFisicos.almacenId, almacenId));
    return this.db.tx.select().from(conteosFisicos).where(and(...conditions));
  }

  // ── Herramientas asignadas ─────────────────────────────────────────────────

  async asignarHerramienta(
    tenantId: string,
    usuarioId: string,
    input: {
      insumoId: string;
      proyectoId?: string;
      asignadoA: string;
      fechaAsignacion: string;
    },
  ) {
    const now = new Date();
    const [row] = await this.db.tx
      .insert(herramientasAsignadas)
      .values({
        id: newId(),
        tenantId,
        insumoId: input.insumoId,
        proyectoId: input.proyectoId ?? null,
        asignadoA: input.asignadoA,
        fechaAsignacion: input.fechaAsignacion,
        estado: 'ASIGNADA',
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();
    return row!;
  }

  async devolverHerramienta(tenantId: string, usuarioId: string, id: string, fechaDevolucion: string) {
    const [row] = await this.db.tx
      .update(herramientasAsignadas)
      .set({
        estado: 'DEVUELTA',
        fechaDevolucion,
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(and(eq(herramientasAsignadas.tenantId, tenantId), eq(herramientasAsignadas.id, id)))
      .returning();
    if (!row) throw new NotFoundException(`Herramienta asignada ${id} no encontrada.`);
    return row;
  }
}
