import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { zPayloadConsumoMaterial } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { stockAlmacen } from '../../db/schema/inventario/stock_almacen.js';
import { movimientosInventario } from '../../db/schema/inventario/movimiento_inventario.js';

@Injectable()
export class InventarioConsumoMaterialHandler implements ProjectionHandler {
  readonly nombre = 'InventarioConsumoMaterial';
  readonly tiposEvento = ['consumo_material'] as const;
  readonly modo = 'sincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadConsumoMaterial.parse(evento.payload);
    const cantidad = new Decimal(payload.cantidad);

    const [stockActual] = await tx
      .select()
      .from(stockAlmacen)
      .where(
        and(
          eq(stockAlmacen.almacenId, payload.almacenId),
          eq(stockAlmacen.insumoId, payload.insumoId),
        ),
      )
      .limit(1);

    const cantidadActual = new Decimal(stockActual?.cantidad ?? '0');
    const wac = new Decimal(stockActual?.costoPorUnitario ?? payload.costoUnitario.amount);

    if (cantidadActual.lessThan(cantidad)) {
      throw new UnprocessableEntityException(
        `Stock insuficiente en almacén ${payload.almacenId}: disponible ${cantidadActual.toFixed(4)}, solicitado ${cantidad.toFixed(4)}.`,
      );
    }

    const nuevaCantidad = cantidadActual.minus(cantidad);
    const costoTotal = cantidad.mul(wac).toFixed(4);

    // Actualizar stock (WAC no cambia en consumo)
    if (stockActual) {
      await tx
        .update(stockAlmacen)
        .set({
          cantidad: nuevaCantidad.toFixed(4),
          updatedAt: new Date(),
        })
        .where(eq(stockAlmacen.id, stockActual.id));
    } else {
      await tx.insert(stockAlmacen).values({
        id: newId(),
        tenantId: evento.tenantId,
        almacenId: payload.almacenId,
        insumoId: payload.insumoId,
        cantidad: nuevaCantidad.toFixed(4),
        costoPorUnitario: wac.toFixed(4),
        moneda: payload.costoUnitario.currency,
        updatedAt: new Date(),
      });
    }

    await tx.insert(movimientosInventario).values({
      id: newId(),
      tenantId: evento.tenantId,
      almacenId: payload.almacenId,
      insumoId: payload.insumoId,
      tipoMovimiento: 'SALIDA',
      cantidad: cantidad.toFixed(4),
      costoUnitario: wac.toFixed(4),
      costoTotal,
      moneda: payload.costoUnitario.currency,
      eventoOperativoId: evento.id,
      partidaId: payload.partidaId ?? null,
      createdBy: evento.createdBy,
    });
  }
}
