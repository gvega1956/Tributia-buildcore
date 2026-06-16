import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { zPayloadRecepcionMaterial } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { stockAlmacen } from '../../db/schema/inventario/stock_almacen.js';
import { movimientosInventario } from '../../db/schema/inventario/movimiento_inventario.js';

@Injectable()
export class InventarioRecepcionMaterialHandler implements ProjectionHandler {
  readonly nombre = 'InventarioRecepcionMaterial';
  readonly tiposEvento = ['recepcion_material'] as const;
  readonly modo = 'sincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadRecepcionMaterial.parse(evento.payload);
    const cantidad = new Decimal(payload.cantidad);
    const costoUnitario = new Decimal(payload.costoUnitario.amount);

    // Leer stock actual (si existe)
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
    const wacActual = new Decimal(stockActual?.costoPorUnitario ?? '0');

    // Costo promedio ponderado: (qty_actual * wac_actual + cantidad_nueva * costo_nuevo) / (qty_actual + cantidad_nueva)
    const nuevaCantidad = cantidadActual.plus(cantidad);
    const nuevoWac = cantidadActual.mul(wacActual).plus(cantidad.mul(costoUnitario)).div(nuevaCantidad);
    const costoTotal = cantidad.mul(costoUnitario).toFixed(4);

    // Upsert stock_almacen
    const now = new Date();
    if (stockActual) {
      await tx
        .update(stockAlmacen)
        .set({
          cantidad: nuevaCantidad.toFixed(4),
          costoPorUnitario: nuevoWac.toFixed(4),
          moneda: payload.costoUnitario.currency,
          updatedAt: now,
          updatedBy: evento.createdBy,
        })
        .where(eq(stockAlmacen.id, stockActual.id));
    } else {
      await tx.insert(stockAlmacen).values({
        id: newId(),
        tenantId: evento.tenantId,
        almacenId: payload.almacenId,
        insumoId: payload.insumoId,
        cantidad: nuevaCantidad.toFixed(4),
        costoPorUnitario: nuevoWac.toFixed(4),
        moneda: payload.costoUnitario.currency,
        createdAt: now,
        createdBy: evento.createdBy,
        updatedAt: now,
        updatedBy: evento.createdBy,
      });
    }

    // Registrar movimiento
    await tx.insert(movimientosInventario).values({
      id: newId(),
      tenantId: evento.tenantId,
      almacenId: payload.almacenId,
      insumoId: payload.insumoId,
      tipoMovimiento: 'ENTRADA',
      cantidad: cantidad.toFixed(4),
      costoUnitario: costoUnitario.toFixed(4),
      costoTotal,
      moneda: payload.costoUnitario.currency,
      eventoOperativoId: evento.id,
      partidaId: evento.partidaId ?? null,
      createdBy: evento.createdBy,
    });
  }
}
