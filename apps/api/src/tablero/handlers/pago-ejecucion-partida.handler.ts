import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and, inArray } from 'drizzle-orm';
import { zPayloadPagoEmitido } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { cuentasPorPagar } from '../../db/schema/compras/cuenta_por_pagar.js';
import { facturasProveedor } from '../../db/schema/compras/factura_proveedor.js';
import { lineasRecepcionOc } from '../../db/schema/compras/recepcion_oc.js';
import { ejecucionPartidas } from '../../db/schema/compras/ejecucion_partida.js';

/**
 * Handler SÍNCRONO para pago_emitido (§7 Tablero de Control).
 *
 * Distribuye el pago a ejecucion_partida.pagado de forma proporcional:
 *   1. Para cada CxP pagada: fracción = cxp.montoOriginal / suma_montos_cxp
 *   2. Pago asignado a CxP: total_pago × fracción
 *   3. Dentro de la factura: distribuye por partida según costo de cada línea recepción
 *
 * Solo se distribuye si la factura tiene recepcion_oc_id (compra con OC).
 * Facturas directas sin recepción no tienen imputación a partida via este handler.
 */
@Injectable()
export class PagoEjecucionPartidaHandler implements ProjectionHandler {
  readonly nombre = 'PagoEjecucionPartida';
  readonly tiposEvento = ['pago_emitido'] as const;
  readonly modo = 'sincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadPagoEmitido.parse(evento.payload);
    const now = new Date();
    const montoTotal = new Decimal(payload.monto.amount);

    if (montoTotal.lte(0) || payload.cuentasPorPagarIds.length === 0) return;

    // 1. Cargar CxPs a pagar
    const cxps = await tx
      .select({
        id: cuentasPorPagar.id,
        montoOriginal: cuentasPorPagar.montoOriginal,
        facturaProveedorId: cuentasPorPagar.facturaProveedorId,
      })
      .from(cuentasPorPagar)
      .where(
        and(
          eq(cuentasPorPagar.tenantId, evento.tenantId),
          inArray(cuentasPorPagar.id, payload.cuentasPorPagarIds),
        ),
      );

    if (cxps.length === 0) return;

    // 2. Suma de montos originales para distribución proporcional
    const sumMontos = cxps.reduce(
      (acc, c) => acc.plus(new Decimal(c.montoOriginal)),
      new Decimal(0),
    );

    if (sumMontos.lte(0)) return;

    // 3. Distribuir el pago a las partidas de cada CxP
    for (const cxp of cxps) {
      const fraccion = new Decimal(cxp.montoOriginal).div(sumMontos);
      const pagoCxp = montoTotal.mul(fraccion);

      // CxP → factura_proveedor → recepcion_oc → lineas
      const [factura] = await tx
        .select({ id: facturasProveedor.id, recepcionOcId: facturasProveedor.recepcionOcId })
        .from(facturasProveedor)
        .where(eq(facturasProveedor.id, cxp.facturaProveedorId))
        .limit(1);

      if (!factura?.recepcionOcId) continue;

      const lineas = await tx
        .select({
          partidaId: lineasRecepcionOc.partidaId,
          cantidadRecibida: lineasRecepcionOc.cantidadRecibida,
          costoUnitario: lineasRecepcionOc.costoUnitario,
        })
        .from(lineasRecepcionOc)
        .where(
          and(
            eq(lineasRecepcionOc.tenantId, evento.tenantId),
            eq(lineasRecepcionOc.recepcionOcId, factura.recepcionOcId),
          ),
        );

      if (lineas.length === 0) continue;

      // Costo total de la recepción para prorratear por partida
      const costoTotalRecepcion = lineas.reduce(
        (acc, l) =>
          acc.plus(new Decimal(l.cantidadRecibida).mul(new Decimal(l.costoUnitario))),
        new Decimal(0),
      );

      if (costoTotalRecepcion.lte(0)) continue;

      // Agrupar por partida (podría haber múltiples líneas para la misma partida)
      const porPartida = new Map<string, Decimal>();
      for (const linea of lineas) {
        const costoLinea = new Decimal(linea.cantidadRecibida).mul(new Decimal(linea.costoUnitario));
        const share = costoLinea.div(costoTotalRecepcion);
        const pagoPartida = pagoCxp.mul(share);
        const prev = porPartida.get(linea.partidaId) ?? new Decimal(0);
        porPartida.set(linea.partidaId, prev.plus(pagoPartida));
      }

      // UPSERT ejecucion_partida.pagado
      for (const [partidaId, monto] of porPartida.entries()) {
        const [existente] = await tx
          .select({ id: ejecucionPartidas.id, pagado: ejecucionPartidas.pagado })
          .from(ejecucionPartidas)
          .where(
            and(
              eq(ejecucionPartidas.tenantId, evento.tenantId),
              eq(ejecucionPartidas.partidaId, partidaId),
            ),
          )
          .limit(1);

        if (existente) {
          await tx
            .update(ejecucionPartidas)
            .set({
              pagado: new Decimal(existente.pagado ?? '0').plus(monto).toFixed(4),
              ultimaActualizacion: now,
              updatedAt: now,
              updatedBy: evento.createdBy,
            })
            .where(eq(ejecucionPartidas.id, existente.id));
        } else {
          await tx.insert(ejecucionPartidas).values({
            id: newId(),
            tenantId: evento.tenantId,
            partidaId,
            comprometido: '0.0000',
            devengado: '0.0000',
            pagado: monto.toFixed(4),
            avanceCantidad: '0.0000',
            presupuestoAdicionalOc: '0.0000',
            cantidadAdicionalOc: '0.0000',
            moneda: 'DOP',
            ultimaActualizacion: now,
            createdAt: now,
            createdBy: evento.createdBy,
            updatedAt: now,
            updatedBy: evento.createdBy,
          });
        }
      }
    }
  }
}
