import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { zPayloadTransferenciaAlmacen } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { stockAlmacen } from '../../db/schema/inventario/stock_almacen.js';
import { movimientosInventario } from '../../db/schema/inventario/movimiento_inventario.js';

@Injectable()
export class InventarioTransferenciaAlmacenHandler implements ProjectionHandler {
  readonly nombre = 'InventarioTransferenciaAlmacen';
  readonly tiposEvento = ['transferencia_almacen'] as const;
  readonly modo = 'sincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadTransferenciaAlmacen.parse(evento.payload);
    const cantidad = new Decimal(payload.cantidad);

    // Stock en almacén origen
    const [stockOrigen] = await tx
      .select()
      .from(stockAlmacen)
      .where(
        and(
          eq(stockAlmacen.almacenId, payload.almacenOrigenId),
          eq(stockAlmacen.insumoId, payload.insumoId),
        ),
      )
      .limit(1);

    const cantidadOrigen = new Decimal(stockOrigen?.cantidad ?? '0');
    const wacOrigen = new Decimal(stockOrigen?.costoPorUnitario ?? '0');
    const moneda = stockOrigen?.moneda ?? 'DOP';

    if (cantidadOrigen.lessThan(cantidad)) {
      throw new UnprocessableEntityException(
        `Stock insuficiente en almacén origen ${payload.almacenOrigenId}: disponible ${cantidadOrigen.toFixed(4)}, solicitado ${cantidad.toFixed(4)}.`,
      );
    }

    // Decrementar origen
    const nuevaCantidadOrigen = cantidadOrigen.minus(cantidad);
    if (stockOrigen) {
      await tx
        .update(stockAlmacen)
        .set({ cantidad: nuevaCantidadOrigen.toFixed(4), updatedAt: new Date() })
        .where(eq(stockAlmacen.id, stockOrigen.id));
    }

    // Stock en almacén destino
    const [stockDestino] = await tx
      .select()
      .from(stockAlmacen)
      .where(
        and(
          eq(stockAlmacen.almacenId, payload.almacenDestinoId),
          eq(stockAlmacen.insumoId, payload.insumoId),
        ),
      )
      .limit(1);

    const cantidadDestino = new Decimal(stockDestino?.cantidad ?? '0');
    const wacDestino = new Decimal(stockDestino?.costoPorUnitario ?? '0');
    const nuevaCantidadDestino = cantidadDestino.plus(cantidad);

    // WAC destino recalcula con el WAC de origen
    const nuevoWacDestino = cantidadDestino.isZero()
      ? wacOrigen
      : cantidadDestino.mul(wacDestino).plus(cantidad.mul(wacOrigen)).div(nuevaCantidadDestino);

    if (stockDestino) {
      await tx
        .update(stockAlmacen)
        .set({
          cantidad: nuevaCantidadDestino.toFixed(4),
          costoPorUnitario: nuevoWacDestino.toFixed(4),
          updatedAt: new Date(),
        })
        .where(eq(stockAlmacen.id, stockDestino.id));
    } else {
      await tx.insert(stockAlmacen).values({
        id: newId(),
        tenantId: evento.tenantId,
        almacenId: payload.almacenDestinoId,
        insumoId: payload.insumoId,
        cantidad: nuevaCantidadDestino.toFixed(4),
        costoPorUnitario: wacOrigen.toFixed(4),
        moneda,
        updatedAt: new Date(),
      });
    }

    const costoTotal = cantidad.mul(wacOrigen).toFixed(4);

    // Dos movimientos: salida del origen, entrada al destino
    await tx.insert(movimientosInventario).values([
      {
        id: newId(),
        tenantId: evento.tenantId,
        almacenId: payload.almacenOrigenId,
        insumoId: payload.insumoId,
        tipoMovimiento: 'TRANSFERENCIA_SALIDA',
        cantidad: cantidad.toFixed(4),
        costoUnitario: wacOrigen.toFixed(4),
        costoTotal,
        moneda,
        eventoOperativoId: evento.id,
        createdBy: evento.createdBy,
      },
      {
        id: newId(),
        tenantId: evento.tenantId,
        almacenId: payload.almacenDestinoId,
        insumoId: payload.insumoId,
        tipoMovimiento: 'TRANSFERENCIA_ENTRADA',
        cantidad: cantidad.toFixed(4),
        costoUnitario: wacOrigen.toFixed(4),
        costoTotal,
        moneda,
        eventoOperativoId: evento.id,
        createdBy: evento.createdBy,
      },
    ]);
  }
}
