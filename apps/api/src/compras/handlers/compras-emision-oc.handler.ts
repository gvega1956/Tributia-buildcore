import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { zPayloadEmisionOc } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ejecucionPartidas } from '../../db/schema/compras/ejecucion_partida.js';

/**
 * Handler SÍNCRONO para el evento emision_oc.
 *
 * Actualiza ejecucion_partida.comprometido para cada partida de las líneas de la OC.
 * NO genera asiento contable (ver ADR-0004: el compromiso no es un gasto).
 */
@Injectable()
export class ComprasEmisionOcHandler implements ProjectionHandler {
  readonly nombre = 'ComprasEmisionOc';
  readonly tiposEvento = ['emision_oc'] as const;
  readonly modo = 'sincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadEmisionOc.parse(evento.payload);
    const now = new Date();

    // Agrupar totales por partida (una OC puede tener múltiples líneas de la misma partida)
    const porPartida = new Map<string, Decimal>();
    for (const linea of payload.lineas) {
      const actual = porPartida.get(linea.partidaId) ?? new Decimal(0);
      porPartida.set(linea.partidaId, actual.plus(new Decimal(linea.total)));
    }

    for (const [partidaId, totalLinea] of porPartida.entries()) {
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
        const nuevoComprometido = new Decimal(existente.comprometido)
          .plus(totalLinea)
          .toFixed(4);

        await tx
          .update(ejecucionPartidas)
          .set({
            comprometido: nuevoComprometido,
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
          comprometido: totalLinea.toFixed(4),
          devengado: '0.0000',
          moneda: payload.moneda,
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
