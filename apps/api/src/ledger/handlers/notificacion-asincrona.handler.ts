import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { proyeccionLedgerStats } from '../../db/schema/ledger/proyeccion_ledger_stats.js';
import type { ProjectionContext, ProjectionHandler } from '../projection.types.js';

/**
 * Handler asíncrono de ejemplo.
 *
 * Se encola en el outbox dentro de la tx del append (atomicidad de encolado).
 * El OutboxWorkerService lo ejecuta en su propia transacción con reintentos.
 *
 * Registra conteo de avance_partida por tenant en proyeccion_ledger_stats.
 * El UPSERT garantiza idempotencia ante re-ejecuciones del worker (at-least-once).
 */
@Injectable()
export class NotificacionAsincronaHandler implements ProjectionHandler {
  readonly nombre = 'NotificacionAsincrona';
  readonly tiposEvento = ['avance_partida'] as const;
  readonly modo = 'asincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    await tx
      .insert(proyeccionLedgerStats)
      .values({
        id: newId(),
        tenantId: evento.tenantId,
        tipoEvento: evento.tipoEvento,
        totalEventos: 1,
      })
      .onConflictDoUpdate({
        target: [proyeccionLedgerStats.tenantId, proyeccionLedgerStats.tipoEvento],
        set: {
          totalEventos: sql`${proyeccionLedgerStats.totalEventos} + 1`,
          ultimaActualizacion: sql`now()`,
        },
      });
  }
}
