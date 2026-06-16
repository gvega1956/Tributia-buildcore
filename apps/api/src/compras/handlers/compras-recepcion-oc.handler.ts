import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { zPayloadRecepcionOc } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { stockAlmacen } from '../../db/schema/inventario/stock_almacen.js';
import { movimientosInventario } from '../../db/schema/inventario/movimiento_inventario.js';
import { ejecucionPartidas } from '../../db/schema/compras/ejecucion_partida.js';
import { scoringProveedor } from '../../db/schema/compras/scoring_proveedor.js';
import { ordenesCompra } from '../../db/schema/compras/orden_compra.js';

/**
 * Handler SÍNCRONO para el evento recepcion_oc.
 *
 * Para cada línea recibida:
 *   1. Actualiza stock_almacen (WAC — costo promedio ponderado)
 *   2. Inserta movimiento_inventario ENTRADA
 *   3. Convierte comprometido → devengado en ejecucion_partida
 *
 * También actualiza scoring_proveedor (puntualidad y contadores).
 *
 * NO genera asiento contable: eso lo hace ContabilidadRecepcionFacturaProveedorHandler
 * en el evento recepcion_factura_proveedor (cuando llega la factura).
 */
@Injectable()
export class ComprasRecepcionOcHandler implements ProjectionHandler {
  readonly nombre = 'ComprasRecepcionOc';
  readonly tiposEvento = ['recepcion_oc'] as const;
  readonly modo = 'sincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadRecepcionOc.parse(evento.payload);
    const now = new Date();

    // ── Por cada línea recibida ───────────────────────────────────────────────
    const totalPorPartida = new Map<string, Decimal>();

    for (const linea of payload.lineas) {
      const cantidadRecibida = new Decimal(linea.cantidadRecibida);
      const costoUnitario = new Decimal(linea.costoUnitario);
      const costoTotal = cantidadRecibida.mul(costoUnitario);

      // 1. Actualizar stock_almacen (WAC)
      const [stockActual] = await tx
        .select()
        .from(stockAlmacen)
        .where(
          and(
            eq(stockAlmacen.almacenId, payload.almacenId),
            eq(stockAlmacen.insumoId, linea.insumoId),
          ),
        )
        .limit(1);

      const cantidadActual = new Decimal(stockActual?.cantidad ?? '0');
      const wacActual = new Decimal(stockActual?.costoPorUnitario ?? '0');
      const nuevaCantidad = cantidadActual.plus(cantidadRecibida);

      let nuevoWac: Decimal;
      if (nuevaCantidad.isZero()) {
        nuevoWac = costoUnitario;
      } else {
        nuevoWac = cantidadActual
          .mul(wacActual)
          .plus(cantidadRecibida.mul(costoUnitario))
          .div(nuevaCantidad);
      }

      if (stockActual) {
        await tx
          .update(stockAlmacen)
          .set({
            cantidad: nuevaCantidad.toFixed(4),
            costoPorUnitario: nuevoWac.toFixed(4),
            moneda: linea.moneda,
            updatedAt: now,
            updatedBy: evento.createdBy,
          })
          .where(eq(stockAlmacen.id, stockActual.id));
      } else {
        await tx.insert(stockAlmacen).values({
          id: newId(),
          tenantId: evento.tenantId,
          almacenId: payload.almacenId,
          insumoId: linea.insumoId,
          cantidad: cantidadRecibida.toFixed(4),
          costoPorUnitario: costoUnitario.toFixed(4),
          moneda: linea.moneda,
          createdAt: now,
          createdBy: evento.createdBy,
          updatedAt: now,
          updatedBy: evento.createdBy,
        });
      }

      // 2. Insertar movimiento_inventario ENTRADA
      await tx.insert(movimientosInventario).values({
        id: newId(),
        tenantId: evento.tenantId,
        almacenId: payload.almacenId,
        insumoId: linea.insumoId,
        tipoMovimiento: 'ENTRADA',
        cantidad: cantidadRecibida.toFixed(4),
        costoUnitario: costoUnitario.toFixed(4),
        costoTotal: costoTotal.toFixed(4),
        moneda: linea.moneda,
        eventoOperativoId: evento.id,
        partidaId: linea.partidaId,
        createdBy: evento.createdBy,
      });

      // 3. Acumular monto por partida para conversión comprometido → devengado
      const actual = totalPorPartida.get(linea.partidaId) ?? new Decimal(0);
      totalPorPartida.set(linea.partidaId, actual.plus(costoTotal));
    }

    // ── Convertir comprometido → devengado en ejecucion_partida ─────────────
    for (const [partidaId, montoDevengado] of totalPorPartida.entries()) {
      const [existente] = await tx
        .select()
        .from(ejecucionPartidas)
        .where(
          and(
            eq(ejecucionPartidas.tenantId, evento.tenantId),
            eq(ejecucionPartidas.partidaId, partidaId),
          ),
        )
        .limit(1);

      if (existente) {
        // Reducir comprometido (no puede quedar negativo), aumentar devengado
        const comprometidoActual = new Decimal(existente.comprometido);
        const nuevoComprometido = Decimal.max(
          new Decimal(0),
          comprometidoActual.minus(montoDevengado),
        );
        const nuevoDevengado = new Decimal(existente.devengado).plus(montoDevengado);

        await tx
          .update(ejecucionPartidas)
          .set({
            comprometido: nuevoComprometido.toFixed(4),
            devengado: nuevoDevengado.toFixed(4),
            ultimaActualizacion: now,
            updatedAt: now,
            updatedBy: evento.createdBy,
          })
          .where(eq(ejecucionPartidas.id, existente.id));
      } else {
        // Si no existe aún (recepción sin OC registrada en sistema), crear devengado directo
        await tx.insert(ejecucionPartidas).values({
          id: newId(),
          tenantId: evento.tenantId,
          partidaId,
          comprometido: '0.0000',
          devengado: montoDevengado.toFixed(4),
          moneda: 'DOP',
          ultimaActualizacion: now,
          createdAt: now,
          createdBy: evento.createdBy,
          updatedAt: now,
          updatedBy: evento.createdBy,
        });
      }
    }

    // ── Actualizar scoring del proveedor (puntualidad basada en OC) ──────────
    await this.actualizarScoring(evento.tenantId, payload.ocId, evento.createdBy, now, tx);
  }

  private async actualizarScoring(
    tenantId: string,
    ocId: string,
    userId: string,
    now: Date,
    tx: ProjectionContext['tx'],
  ): Promise<void> {
    // Leer la OC para comparar fecha prometida vs fecha real de recepción
    const [oc] = await tx
      .select()
      .from(ordenesCompra)
      .where(eq(ordenesCompra.id, ocId))
      .limit(1);

    if (!oc) return;

    const aTime =
      !oc.fechaEntregaPrometida ||
      new Date() <= new Date(oc.fechaEntregaPrometida);

    const [existente] = await tx
      .select()
      .from(scoringProveedor)
      .where(
        and(
          eq(scoringProveedor.tenantId, tenantId),
          eq(scoringProveedor.terceroId, oc.terceroId),
        ),
      )
      .limit(1);

    if (existente) {
      const totalRec = existente.totalRecepciones + 1;
      const totalATiempo = existente.totalRecepcionesATiempo + (aTime ? 1 : 0);
      const scorePunt = new Decimal(totalATiempo).div(totalRec).mul(100).toFixed(2);

      // score_total = 40% puntualidad + 40% calidad + 20% precio (pesos definidos aquí)
      const scoreCalidad = new Decimal(existente.scoreCalidad);
      const scorePrecio = new Decimal(existente.scorePrecio);
      const scoreTotal = new Decimal(scorePunt)
        .mul('0.4')
        .plus(scoreCalidad.mul('0.4'))
        .plus(scorePrecio.mul('0.2'))
        .toFixed(2);

      await tx
        .update(scoringProveedor)
        .set({
          totalRecepciones: totalRec,
          totalRecepcionesATiempo: totalATiempo,
          scorePuntualidad: scorePunt,
          scoreTotal,
          ultimaActualizacion: now,
          updatedAt: now,
          updatedBy: userId,
        })
        .where(eq(scoringProveedor.id, existente.id));
    } else {
      const scorePunt = aTime ? '100.00' : '0.00';
      const scoreTotal = new Decimal(scorePunt)
        .mul('0.4')
        .plus(new Decimal('100').mul('0.4'))
        .plus(new Decimal('100').mul('0.2'))
        .toFixed(2);

      await tx.insert(scoringProveedor).values({
        id: newId(),
        tenantId,
        terceroId: oc.terceroId,
        totalOcs: 1,
        totalRecepciones: 1,
        totalRecepcionesATiempo: aTime ? 1 : 0,
        totalRechazos: 0,
        totalDiscrepanciasPrecio: 0,
        scorePuntualidad: scorePunt,
        scoreCalidad: '100.00',
        scorePrecio: '100.00',
        scoreTotal,
        monedaBase: 'DOP',
        ultimaActualizacion: now,
        createdAt: now,
        createdBy: userId,
        updatedAt: now,
        updatedBy: userId,
      });
    }
  }
}
