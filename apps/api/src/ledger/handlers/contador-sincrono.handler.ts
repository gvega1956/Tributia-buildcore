import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { proyeccionLedgerStats } from '../../db/schema/ledger/proyeccion_ledger_stats.js';
import type { ProjectionContext, ProjectionHandler } from '../projection.types.js';

/**
 * Handler síncrono de ejemplo.
 *
 * Se ejecuta en la misma transacción del append del evento.
 * Si falla, el evento completo se revierte (atomicidad garantizada).
 *
 * Registra conteo de consumo_material por tenant en proyeccion_ledger_stats.
 */
@Injectable()
export class ContadorSincronoHandler implements ProjectionHandler {
  readonly nombre = 'ContadorSincrono';
  readonly tiposEvento = ['consumo_material'] as const;
  readonly modo = 'sincrono' as const;

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
