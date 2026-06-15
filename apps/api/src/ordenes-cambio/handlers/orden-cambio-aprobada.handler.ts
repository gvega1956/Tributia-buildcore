import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { zPayloadOrdenCambioAprobada } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ejecucionPartidas } from '../../db/schema/compras/ejecucion_partida.js';

/**
 * Handler SÍNCRONO para el evento orden_cambio_aprobada.
 *
 * Por cada línea de la OC con partidaId:
 *   - Incrementa ejecucion_partida.presupuesto_adicional_oc
 *   - Incrementa ejecucion_partida.cantidad_adicional_oc
 *
 * Esto actualiza el "presupuesto vigente por partida":
 *   vigente = linea_presupuesto.total (BASE) + presupuesto_adicional_oc
 */
@Injectable()
export class OrdenCambioAprobadaHandler implements ProjectionHandler {
  readonly nombre = 'OrdenCambioAprobada';
  readonly tiposEvento = ['orden_cambio_aprobada'] as const;
  readonly modo = 'sincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadOrdenCambioAprobada.parse(evento.payload);
    const now = new Date();

    for (const linea of payload.lineas) {
      if (!linea.partidaId) continue; // partida nueva sin FK aún — no actualizar

      const montoAdicional = new Decimal(linea.montoAdicional);
      const cantidadAdicional = linea.cantidadAdicional
        ? new Decimal(linea.cantidadAdicional)
        : new Decimal(0);

      const [existente] = await tx
        .select()
        .from(ejecucionPartidas)
        .where(
          and(
            eq(ejecucionPartidas.tenantId, evento.tenantId),
            eq(ejecucionPartidas.partidaId, linea.partidaId),
          ),
        )
        .limit(1);

      if (existente) {
        await tx
          .update(ejecucionPartidas)
          .set({
            presupuestoAdicionalOc: new Decimal(existente.presupuestoAdicionalOc)
              .plus(montoAdicional)
              .toFixed(4),
            cantidadAdicionalOc: new Decimal(existente.cantidadAdicionalOc)
              .plus(cantidadAdicional)
              .toFixed(4),
            ultimaActualizacion: now,
            updatedAt: now,
            updatedBy: evento.createdBy,
          })
          .where(eq(ejecucionPartidas.id, existente.id));
      } else {
        await tx.insert(ejecucionPartidas).values({
          id: newId(),
          tenantId: evento.tenantId,
          partidaId: linea.partidaId,
          comprometido: '0.0000',
          devengado: '0.0000',
          avanceCantidad: '0.0000',
          presupuestoAdicionalOc: montoAdicional.toFixed(4),
          cantidadAdicionalOc: cantidadAdicional.toFixed(4),
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
