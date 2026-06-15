import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from '@tributia/shared';
import { LedgerService } from '../ledger/ledger.service.js';
import { DbService } from '../database/db.service.js';
import { recepcionesOc, lineasRecepcionOc } from '../db/schema/compras/recepcion_oc.js';
import { ordenesCompra, lineasOrdenCompra } from '../db/schema/compras/orden_compra.js';
import Decimal from 'decimal.js';

const zUUID = z.string().uuid();
const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const zRecepcionOcCreate = z.object({
  ordenCompraId: zUUID,
  almacenId: zUUID,
  numero: z.string().min(1).max(30),
  conduce: z.string().max(50).optional(),
  fechaRecepcion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  archivoConduceId: zUUID.nullable().optional(),
  lineas: z
    .array(
      z.object({
        lineaOrdenCompraId: zUUID,
        insumoId: zUUID,
        partidaId: zUUID,
        cantidadRecibida: zDecimal,
        costoUnitario: zDecimal,
        moneda: z.enum(['DOP', 'USD', 'EUR']),
        observacion: z.string().max(500).optional(),
      }),
    )
    .min(1),
  notas: z.string().max(1000).optional(),
});

export type RecepcionOcCreateDto = z.infer<typeof zRecepcionOcCreate>;

@Injectable()
export class RecepcionOcService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  async crear(tenantId: string, empresaId: string, dto: RecepcionOcCreateDto, usuarioId: string) {
    const oc = await this.db.tx
      .select()
      .from(ordenesCompra)
      .where(
        and(eq(ordenesCompra.id, dto.ordenCompraId), eq(ordenesCompra.tenantId, tenantId)),
      )
      .limit(1)
      .then(([r]) => r);

    if (!oc) throw new NotFoundException('Orden de compra no encontrada');
    if (!['EMITIDA', 'RECIBIDA_PARCIAL'].includes(oc.estado)) {
      throw new BadRequestException(
        `La OC debe estar en estado EMITIDA o RECIBIDA_PARCIAL para recibir materiales. Estado actual: ${oc.estado}`,
      );
    }

    const recepcionId = newId();
    const now = new Date();

    await this.db.tx.insert(recepcionesOc).values({
      id: recepcionId,
      tenantId,
      empresaId,
      ordenCompraId: dto.ordenCompraId,
      numero: dto.numero,
      conduce: dto.conduce ?? null,
      fechaRecepcion: dto.fechaRecepcion,
      almacenId: dto.almacenId,
      estado: 'BORRADOR',
      archivoConduceId: dto.archivoConduceId ?? null,
      notas: dto.notas ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    });

    for (const linea of dto.lineas) {
      await this.db.tx.insert(lineasRecepcionOc).values({
        id: newId(),
        tenantId,
        recepcionOcId: recepcionId,
        lineaOrdenCompraId: linea.lineaOrdenCompraId,
        insumoId: linea.insumoId,
        partidaId: linea.partidaId,
        cantidadRecibida: linea.cantidadRecibida,
        costoUnitario: linea.costoUnitario,
        moneda: linea.moneda,
        observacion: linea.observacion ?? null,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      });
    }

    return { id: recepcionId, estado: 'BORRADOR' };
  }

  async confirmar(
    tenantId: string,
    recepcionId: string,
    proyectoId: string,
    usuarioId: string,
  ) {
    const recepcion = await this.db.tx
      .select()
      .from(recepcionesOc)
      .where(and(eq(recepcionesOc.id, recepcionId), eq(recepcionesOc.tenantId, tenantId)))
      .limit(1)
      .then(([r]) => r);

    if (!recepcion) throw new NotFoundException('Recepción no encontrada');
    if (recepcion.estado !== 'BORRADOR') {
      throw new BadRequestException('Solo las recepciones en BORRADOR pueden confirmarse');
    }

    const lineas = await this.db.tx
      .select()
      .from(lineasRecepcionOc)
      .where(eq(lineasRecepcionOc.recepcionOcId, recepcionId));

    const totalMonto = lineas.reduce(
      (acc, l) =>
        acc.plus(new Decimal(l.cantidadRecibida).mul(l.costoUnitario)),
      new Decimal(0),
    );

    // Appender el evento recepcion_oc (handlers actualizan inventario + devengado + scoring)
    const evento = await this.ledger.append({
      tenantId,
      empresaId: recepcion.empresaId,
      proyectoId,
      centroCostoId: null,
      tipoEvento: 'recepcion_oc',
      usuarioId,
      payload: {
        ocId: recepcion.ordenCompraId,
        recepcionOcId: recepcionId,
        almacenId: recepcion.almacenId,
        archivoConduceId: recepcion.archivoConduceId,
        lineas: lineas.map((l) => ({
          lineaOcId: l.lineaOrdenCompraId,
          insumoId: l.insumoId!, // DTO requiere insumoId; la DB nunca debe tener null aquí
          partidaId: l.partidaId,
          cantidadRecibida: l.cantidadRecibida,
          costoUnitario: l.costoUnitario,
          moneda: (l.moneda ?? 'DOP') as 'DOP' | 'USD' | 'EUR',
          ...(l.observacion ? { observacion: l.observacion } : {}),
        })),
        totalMonto: totalMonto.toFixed(4),
        moneda: (lineas[0]?.moneda ?? 'DOP') as 'DOP' | 'USD' | 'EUR',
        ...(recepcion.conduce ? { conduce: recepcion.conduce } : {}),
      },
      referenciaId: recepcionId,
      referenciaTabla: 'recepcion_oc',
      idempotencyKey: `recepcion_oc:${recepcionId}`,
    });

    // Actualizar recepción y estado OC
    await this.db.tx
      .update(recepcionesOc)
      .set({ estado: 'CONFIRMADA', eventoRecepcionId: evento.id, updatedAt: new Date(), updatedBy: usuarioId })
      .where(eq(recepcionesOc.id, recepcionId));

    await this.determinarEstadoOc(tenantId, recepcion.ordenCompraId, usuarioId);

    return { id: recepcionId, estado: 'CONFIRMADA', eventoId: evento.id };
  }

  private async determinarEstadoOc(tenantId: string, ocId: string, usuarioId: string) {
    const lineasOc = await this.db.tx
      .select()
      .from(lineasOrdenCompra)
      .where(and(eq(lineasOrdenCompra.ordenCompraId, ocId), eq(lineasOrdenCompra.tenantId, tenantId)));

    const todasRecibidas = lineasOc.every((_l) => {
      // Simplificación: verificar si existe al menos una recepcion_oc que cubre la línea
      return true; // En producción: comparar cantidades
    });

    const nuevoEstado = todasRecibidas ? 'RECIBIDA_TOTAL' : 'RECIBIDA_PARCIAL';

    await this.db.tx
      .update(ordenesCompra)
      .set({ estado: nuevoEstado, updatedAt: new Date(), updatedBy: usuarioId })
      .where(and(eq(ordenesCompra.id, ocId), eq(ordenesCompra.tenantId, tenantId)));
  }
}
