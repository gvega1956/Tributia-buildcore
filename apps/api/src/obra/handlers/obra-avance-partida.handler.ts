import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { zPayloadAvancePartida } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ejecucionPartidas } from '../../db/schema/compras/ejecucion_partida.js';
import { partidas } from '../../db/schema/proyectos/partida.js';
import { outbox } from '../../db/schema/ledger/outbox.js';

/**
 * Handler SÍNCRONO para el evento avance_partida.
 *
 * El avance se mide por CANTIDAD ejecutada (m³, m², ml, unidades...).
 * Nunca por porcentaje de opinión — es el diferenciador arquitectónico de P5.
 *
 * Consecuencias síncronas en la misma transacción:
 *   1. Incrementa ejecucion_partida.avance_cantidad
 *   2. Si avance acumulado > cantidad_presupuestada: inserta alerta en outbox
 *      (no bloquea — el residente gestiona un cambio de orden si aplica)
 */
@Injectable()
export class ObraAvancePartidaHandler implements ProjectionHandler {
  private readonly logger = new Logger(ObraAvancePartidaHandler.name);

  readonly nombre = 'ObraAvancePartida';
  readonly tiposEvento = ['avance_partida'] as const;
  readonly modo = 'sincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadAvancePartida.parse(evento.payload);
    const now = new Date();
    const cantidadEjecutada = new Decimal(payload.cantidadEjecutada);

    // ── 1. UPSERT en ejecucion_partida para acumular avance_cantidad ──────────
    const [existente] = await tx
      .select()
      .from(ejecucionPartidas)
      .where(
        and(
          eq(ejecucionPartidas.tenantId, evento.tenantId),
          eq(ejecucionPartidas.partidaId, payload.partidaId),
        ),
      )
      .limit(1);

    let avanceCantidadNuevo: Decimal;

    if (existente) {
      const avanceActual = new Decimal(existente.avanceCantidad ?? '0');
      avanceCantidadNuevo = avanceActual.plus(cantidadEjecutada);

      await tx
        .update(ejecucionPartidas)
        .set({
          avanceCantidad: avanceCantidadNuevo.toFixed(4),
          ultimaActualizacion: now,
          updatedAt: now,
          updatedBy: evento.createdBy,
        })
        .where(eq(ejecucionPartidas.id, existente.id));
    } else {
      avanceCantidadNuevo = cantidadEjecutada;

      await tx.insert(ejecucionPartidas).values({
        id: newId(),
        tenantId: evento.tenantId,
        partidaId: payload.partidaId,
        comprometido: '0.0000',
        devengado: '0.0000',
        avanceCantidad: cantidadEjecutada.toFixed(4),
        moneda: 'DOP',
        ultimaActualizacion: now,
        createdAt: now,
        createdBy: evento.createdBy,
        updatedAt: now,
        updatedBy: evento.createdBy,
      });
    }

    // ── 2. Alertar si el avance acumulado supera la cantidad presupuestada ─────
    const [partida] = await tx
      .select({ cantidadPresupuestada: partidas.cantidadPresupuestada })
      .from(partidas)
      .where(eq(partidas.id, payload.partidaId))
      .limit(1);

    if (
      partida?.cantidadPresupuestada &&
      avanceCantidadNuevo.gt(new Decimal(partida.cantidadPresupuestada))
    ) {
      this.logger.warn(
        `Avance acumulado (${avanceCantidadNuevo.toFixed(4)}) supera ` +
        `cantidad_presupuestada (${partida.cantidadPresupuestada}) ` +
        `en partida ${payload.partidaId}`,
      );

      await tx.insert(outbox).values({
        id: newId(),
        eventoId: evento.id,
        handlerNombre: 'ALERTA_AVANCE_EXCESO',
        tenantId: evento.tenantId,
        payload: {
          tipo: 'ALERTA_AVANCE_EXCESO',
          proyectoId: payload.proyectoId,
          partidaId: payload.partidaId,
          avanceCantidadNuevo: avanceCantidadNuevo.toFixed(4),
          cantidadPresupuestada: partida.cantidadPresupuestada,
          eventoId: evento.id,
        },
        estado: 'pendiente',
        intentos: 0,
        maxIntentos: 5,
        proximoIntentoEn: now,
      });
    }
  }
}
