import { Injectable, Inject } from '@nestjs/common';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { outbox } from '../db/schema/ledger/outbox.js';
import type { EventoOperativoSelect } from '../db/schema/ledger/evento_operativo.js';
import { PROJECTION_HANDLER_TOKEN, type ProjectionHandler } from './projection.types.js';

/**
 * Motor de proyecciones.
 *
 * Mantiene dos registros de handlers por tipo_evento: sincrono y asincrono.
 *
 * - runSync(): ejecuta handlers síncronos en la transacción activa del ledger.
 *   Si un handler falla, toda la transacción (incluido el evento) se revierte.
 *
 * - enqueueAsync(): inserta una fila en outbox por cada handler asíncrono,
 *   dentro de la misma transacción que el evento (atomicidad de encolado garantizada).
 */
@Injectable()
export class ProjectionEngineService {
  private readonly syncMap = new Map<string, ProjectionHandler[]>();
  private readonly asyncMap = new Map<string, ProjectionHandler[]>();

  constructor(
    @Inject(PROJECTION_HANDLER_TOKEN) handlers: ProjectionHandler[],
    private readonly dbService: DbService,
  ) {
    for (const handler of handlers) {
      const map = handler.modo === 'sincrono' ? this.syncMap : this.asyncMap;
      for (const tipo of handler.tiposEvento) {
        if (!map.has(tipo)) map.set(tipo, []);
        map.get(tipo)!.push(handler);
      }
    }
  }

  async runSync(evento: EventoOperativoSelect): Promise<void> {
    const handlers = this.syncMap.get(evento.tipoEvento) ?? [];
    for (const handler of handlers) {
      await handler.ejecutar({ evento, tx: this.dbService.tx });
    }
  }

  async enqueueAsync(evento: EventoOperativoSelect): Promise<void> {
    const handlers = this.asyncMap.get(evento.tipoEvento) ?? [];
    for (const handler of handlers) {
      await this.dbService.tx
        .insert(outbox)
        .values({
          id: newId(),
          eventoId: evento.id,
          handlerNombre: handler.nombre,
          tenantId: evento.tenantId,
          payload: evento as unknown as Record<string, unknown>,
        })
        .onConflictDoNothing();
    }
  }

  /** Devuelve todos los handlers registrados (usado por el worker para lookup por nombre). */
  getHandlersPorNombre(): Map<string, ProjectionHandler> {
    const all = new Map<string, ProjectionHandler>();
    for (const handlers of this.syncMap.values()) {
      for (const h of handlers) all.set(h.nombre, h);
    }
    for (const handlers of this.asyncMap.values()) {
      for (const h of handlers) all.set(h.nombre, h);
    }
    return all;
  }
}
