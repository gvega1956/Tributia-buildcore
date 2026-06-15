import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { zPayloadAvancePartida } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ejecucionPartidas } from '../../db/schema/compras/ejecucion_partida.js';
import { partidas } from '../../db/schema/proyectos/partida.js';
import { versionesPresupuesto } from '../../db/schema/proyectos/presupuesto.js';
import { lineasPresupuesto } from '../../db/schema/proyectos/presupuesto.js';
import { outbox } from '../../db/schema/ledger/outbox.js';

/**
 * Handler SÍNCRONO para el evento avance_partida.
 *
 * El avance se mide por CANTIDAD ejecutada (m³, m², ml, unidades...).
 * Nunca por porcentaje de opinión — es el diferenciador arquitectónico de P5.
 *
 * Consecuencias síncronas en la misma transacción:
 *   1. Incrementa ejecucion_partida.avance_cantidad
 *   2. REGLA DE ORO: si la partida no tiene línea en presupuesto BASE aprobado
 *      → inserta ALERTA_TRABAJO_SIN_PRESUPUESTO en outbox
 *   3. Si avance acumulado > cantidad vigente (BASE + OC delta):
 *      → inserta ALERTA_AVANCE_EXCESO en outbox
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

    // ── 2. REGLA DE ORO: alertar si partida sin cobertura en presupuesto BASE ─
    if (evento.proyectoId) {
      const [baseVersion] = await tx
        .select({ id: versionesPresupuesto.id })
        .from(versionesPresupuesto)
        .where(
          and(
            eq(versionesPresupuesto.tenantId, evento.tenantId),
            eq(versionesPresupuesto.proyectoId, evento.proyectoId),
            eq(versionesPresupuesto.tipo, 'BASE'),
            eq(versionesPresupuesto.estado, 'APROBADO'),
          ),
        )
        .limit(1);

      if (baseVersion) {
        const [lineaBase] = await tx
          .select({ id: lineasPresupuesto.id })
          .from(lineasPresupuesto)
          .where(
            and(
              eq(lineasPresupuesto.versionPresupuestoId, baseVersion.id),
              eq(lineasPresupuesto.partidaId, payload.partidaId),
            ),
          )
          .limit(1);

        if (!lineaBase) {
          this.logger.warn(
            `Regla de Oro: partida ${payload.partidaId} sin cobertura en presupuesto BASE`,
          );

          await tx.insert(outbox).values({
            id: newId(),
            eventoId: evento.id,
            handlerNombre: 'ALERTA_TRABAJO_SIN_PRESUPUESTO',
            tenantId: evento.tenantId,
            payload: {
              tipo: 'ALERTA_TRABAJO_SIN_PRESUPUESTO',
              proyectoId: evento.proyectoId,
              partidaId: payload.partidaId,
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

    // ── 3. Alertar si avance acumulado supera la cantidad vigente (BASE + OC) ─
    const [partida] = await tx
      .select({ cantidadPresupuestada: partidas.cantidadPresupuestada })
      .from(partidas)
      .where(eq(partidas.id, payload.partidaId))
      .limit(1);

    if (partida?.cantidadPresupuestada) {
      const cantidadAdicionalOc = new Decimal(existente?.cantidadAdicionalOc ?? '0');
      const cantidadVigente = new Decimal(partida.cantidadPresupuestada).plus(cantidadAdicionalOc);

      if (avanceCantidadNuevo.gt(cantidadVigente)) {
        this.logger.warn(
          `Avance acumulado (${avanceCantidadNuevo.toFixed(4)}) supera ` +
          `cantidad vigente (${cantidadVigente.toFixed(4)}) ` +
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
}
