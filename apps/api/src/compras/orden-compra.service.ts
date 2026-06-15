import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and, isNull } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type { OrdenCompraCreateInput } from '@tributia/compras';
import { DbService } from '../database/db.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ordenesCompra, lineasOrdenCompra } from '../db/schema/compras/orden_compra.js';
import { partidas } from '../db/schema/proyectos/partida.js';

@Injectable()
export class OrdenCompraService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  async create(tenantId: string, usuarioId: string, input: OrdenCompraCreateInput) {
    const now = new Date();
    const numero = `OC-${Date.now()}`;

    const totalMonto = input.lineas
      .reduce((acc: Decimal, l: { total: string }) => acc.plus(new Decimal(l.total)), new Decimal(0))
      .toFixed(4);

    // Derivar proyectoId desde la primera línea (todas deben ser del mismo proyecto
    // en Compras I; en Compras II se validará multi-partida)
    try {
      const [oc] = await this.db.tx
        .insert(ordenesCompra)
        .values({
          id: newId(),
          tenantId,
          empresaId: input.empresaId,
          numero,
          estado: 'BORRADOR',
          terceroId: input.terceroId,
          cotizacionId: input.cotizacionId ?? null,
          fechaEmision: input.fechaEmision ?? null,
          fechaEntregaPrometida: input.fechaEntregaPrometida ?? null,
          condicionesPago: input.condicionesPago ?? null,
          totalMonto,
          moneda: input.lineas[0]!.moneda,
          notas: input.notas ?? null,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        })
        .returning();

      for (const linea of input.lineas) {
        await this.db.tx.insert(lineasOrdenCompra).values({
          id: newId(),
          tenantId,
          ordenCompraId: oc!.id,
          partidaId: linea.partidaId,
          insumoId: linea.insumoId ?? null,
          descripcion: linea.descripcion,
          cantidad: linea.cantidad,
          unidadMedida: linea.unidadMedida,
          precioUnitario: linea.precioUnitario,
          total: linea.total,
          moneda: linea.moneda,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        });
      }

      return oc!;
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) throw new ConflictException('Conflicto al crear la OC.');
      throw err;
    }
  }

  async aprobar(tenantId: string, usuarioId: string, id: string) {
    const [oc] = await this.db.tx
      .select()
      .from(ordenesCompra)
      .where(and(eq(ordenesCompra.tenantId, tenantId), eq(ordenesCompra.id, id)))
      .limit(1);

    if (!oc) throw new NotFoundException(`OC ${id} no encontrada.`);
    if (oc.estado !== 'BORRADOR' && oc.estado !== 'PENDIENTE_APROBACION') {
      throw new BadRequestException(`No se puede aprobar una OC en estado ${oc.estado}.`);
    }

    const now = new Date();
    const [updated] = await this.db.tx
      .update(ordenesCompra)
      .set({ estado: 'APROBADA', updatedAt: now, updatedBy: usuarioId })
      .where(eq(ordenesCompra.id, id))
      .returning();

    return updated!;
  }

  /**
   * Emite la OC aprobada: cambia estado a EMITIDA y registra evento emision_oc.
   * El handler ComprasEmisionOcHandler actualiza ejecucion_partida.comprometido
   * dentro de la misma transacción (modo síncrono).
   */
  async emitir(tenantId: string, empresaId: string, usuarioId: string, id: string) {
    const [oc] = await this.db.tx
      .select()
      .from(ordenesCompra)
      .where(and(eq(ordenesCompra.tenantId, tenantId), eq(ordenesCompra.id, id)))
      .limit(1);

    if (!oc) throw new NotFoundException(`OC ${id} no encontrada.`);
    if (oc.estado !== 'APROBADA') {
      throw new BadRequestException(`Solo se puede emitir una OC en estado APROBADA. Estado actual: ${oc.estado}.`);
    }

    const lineas = await this.db.tx
      .select()
      .from(lineasOrdenCompra)
      .where(eq(lineasOrdenCompra.ordenCompraId, id));

    if (lineas.length === 0) {
      throw new BadRequestException('La OC no tiene líneas.');
    }

    // Derivar proyectoId desde la primera partida (todas las partidas de una OC
    // deben pertenecer al mismo proyecto en Compras I)
    const [primeraPartida] = await this.db.tx
      .select({ proyectoId: partidas.proyectoId })
      .from(partidas)
      .where(eq(partidas.id, lineas[0]!.partidaId))
      .limit(1);

    if (!primeraPartida) {
      throw new BadRequestException('No se pudo derivar el proyecto de las partidas de la OC.');
    }

    const evento = await this.ledger.append({
      tenantId,
      empresaId,
      proyectoId: primeraPartida.proyectoId,
      centroCostoId: null,
      tipoEvento: 'emision_oc',
      usuarioId,
      payload: {
        ocId: oc.id,
        totalMonto: oc.totalMonto,
        moneda: oc.moneda,
        lineas: lineas.map((l) => ({
          lineaOcId: l.id,
          partidaId: l.partidaId,
          insumoId: l.insumoId,
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          total: l.total,
        })),
      },
      referenciaId: oc.id,
      referenciaTabla: 'orden_compra',
      idempotencyKey: `emision_oc:${oc.id}`,
    });

    const now = new Date();
    const [updated] = await this.db.tx
      .update(ordenesCompra)
      .set({
        estado: 'EMITIDA',
        eventoEmisionId: evento.id,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(ordenesCompra.id, id))
      .returning();

    return { oc: updated!, evento };
  }

  async findAll(tenantId: string, empresaId?: string) {
    return this.db.tx
      .select()
      .from(ordenesCompra)
      .where(
        and(
          eq(ordenesCompra.tenantId, tenantId),
          empresaId ? eq(ordenesCompra.empresaId, empresaId) : undefined,
          isNull(ordenesCompra.deletedAt),
        ),
      );
  }

  async findById(tenantId: string, id: string) {
    const [oc] = await this.db.tx
      .select()
      .from(ordenesCompra)
      .where(and(eq(ordenesCompra.tenantId, tenantId), eq(ordenesCompra.id, id)))
      .limit(1);

    if (!oc) throw new NotFoundException(`OC ${id} no encontrada.`);

    const lineas = await this.db.tx
      .select()
      .from(lineasOrdenCompra)
      .where(eq(lineasOrdenCompra.ordenCompraId, id));

    return { ...oc, lineas };
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
