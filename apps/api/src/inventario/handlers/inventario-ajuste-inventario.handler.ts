import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { zPayloadAjusteInventario } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { stockAlmacen } from '../../db/schema/inventario/stock_almacen.js';
import { movimientosInventario } from '../../db/schema/inventario/movimiento_inventario.js';

@Injectable()
export class InventarioAjusteInventarioHandler implements ProjectionHandler {
  readonly nombre = 'InventarioAjusteInventario';
  readonly tiposEvento = ['ajuste_inventario'] as const;
  readonly modo = 'sincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadAjusteInventario.parse(evento.payload);
    const cantidadFisica = new Decimal(payload.cantidadFisica);
    const cantidadSistema = new Decimal(payload.cantidadSistema);
    const costoUnitario = new Decimal(payload.costoUnitario.amount);
    const diferencia = cantidadFisica.minus(cantidadSistema);

    // Upsert stock_almacen con la cantidad física como fuente de verdad
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

    const wac = new Decimal(stockActual?.costoPorUnitario ?? payload.costoUnitario.amount);

    if (stockActual) {
      await tx
        .update(stockAlmacen)
        .set({
          cantidad: cantidadFisica.toFixed(4),
          updatedAt: new Date(),
        })
        .where(eq(stockAlmacen.id, stockActual.id));
    } else {
      await tx.insert(stockAlmacen).values({
        id: newId(),
        tenantId: evento.tenantId,
        almacenId: payload.almacenId,
        insumoId: payload.insumoId,
        cantidad: cantidadFisica.toFixed(4),
        costoPorUnitario: wac.toFixed(4),
        moneda: payload.costoUnitario.currency,
        updatedAt: new Date(),
      });
    }

    // Solo registrar movimiento si hay diferencia real
    if (diferencia.isZero()) return;

    const absDiferencia = diferencia.abs();
    const costoTotal = absDiferencia.mul(costoUnitario).toFixed(4);
    const tipoMovimiento = diferencia.greaterThan(0) ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';

    await tx.insert(movimientosInventario).values({
      id: newId(),
      tenantId: evento.tenantId,
      almacenId: payload.almacenId,
      insumoId: payload.insumoId,
      tipoMovimiento,
      cantidad: absDiferencia.toFixed(4),
      costoUnitario: costoUnitario.toFixed(4),
      costoTotal,
      moneda: payload.costoUnitario.currency,
      eventoOperativoId: evento.id,
      createdBy: evento.createdBy,
    });
  }
}
