import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Inject,
} from '@nestjs/common';
import { sql, eq, and, lte, inArray } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { outbox, type OutboxSelect } from '../db/schema/ledger/outbox.js';
import { PROJECTION_HANDLER_TOKEN, type ProjectionHandler, type ProjectionContext } from './projection.types.js';
import type { EventoOperativoSelect } from '../db/schema/ledger/evento_operativo.js';

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 10;

/**
 * Worker del outbox transaccional.
 *
 * Garantías:
 *  - At-least-once: reintenta hasta max_intentos veces con backoff exponencial.
 *  - Dead-letter: estado='fallido' cuando intentos >= max_intentos.
 *  - No duplicados de procesamiento: FOR UPDATE SKIP LOCKED previene que varios
 *    workers (o ciclos solapados) procesen la misma entrada simultáneamente.
 *  - Idempotencia de handlers: los handlers usan UPSERT — seguros ante re-ejecución.
 */
@Injectable()
export class OutboxWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private readonly handlersPorNombre: Map<string, ProjectionHandler>;
  private intervalId?: ReturnType<typeof setInterval>;
  private cicloActivo = false;

  constructor(
    @Inject(PROJECTION_HANDLER_TOKEN) handlers: ProjectionHandler[],
    private readonly dbService: DbService,
  ) {
    this.handlersPorNombre = new Map(handlers.map((h) => [h.nombre, h]));
  }

  onApplicationBootstrap(): void {
    this.intervalId = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    this.logger.log(`Outbox worker iniciado (intervalo: ${POLL_INTERVAL_MS}ms)`);
  }

  onApplicationShutdown(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.logger.log('Outbox worker detenido');
  }

  private async poll(): Promise<void> {
    if (this.cicloActivo) return;
    this.cicloActivo = true;
    try {
      const pendientes = await this.reclamarEntradas();
      if (pendientes.length > 0) {
        await Promise.all(pendientes.map((entry) => this.procesarEntrada(entry)));
      }
    } catch (err: unknown) {
      this.logger.error('Error en ciclo de polling del outbox', err);
    } finally {
      this.cicloActivo = false;
    }
  }

  /**
   * Selecciona hasta BATCH_SIZE entradas pendientes y las marca como 'procesando'
   * en una sola transacción atómica. FOR UPDATE SKIP LOCKED evita conflictos
   * entre instancias del worker.
   */
  private async reclamarEntradas(): Promise<OutboxSelect[]> {
    return this.dbService.appDb.transaction(async (tx) => {
      const entries = await tx
        .select()
        .from(outbox)
        .where(and(eq(outbox.estado, 'pendiente'), lte(outbox.proximoIntentoEn, sql`now()`)))
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true });

      if (entries.length > 0) {
        await tx
          .update(outbox)
          .set({ estado: 'procesando' })
          .where(inArray(outbox.id, entries.map((e) => e.id)));
      }

      return entries;
    });
  }

  private async procesarEntrada(entry: OutboxSelect): Promise<void> {
    try {
      await this.dbService.appDb.transaction(async (tx) => {
        // Establece el tenant para que RLS permita escribir en proyeccion_ledger_stats.
        await tx.execute(sql`SET LOCAL app.tenant_id = ${entry.tenantId}`);

        const handler = this.handlersPorNombre.get(entry.handlerNombre);
        if (!handler) throw new Error(`Handler no registrado: ${entry.handlerNombre}`);

        const ctx: ProjectionContext = {
          evento: entry.payload as EventoOperativoSelect,
          tx,
        };
        await handler.ejecutar(ctx);

        await tx
          .update(outbox)
          .set({ estado: 'completado', procesadoEn: sql`now()` })
          .where(eq(outbox.id, entry.id));
      });
    } catch (err: unknown) {
      await this.manejarFallo(entry, err);
    }
  }

  private async manejarFallo(entry: OutboxSelect, err: unknown): Promise<void> {
    const nuevoIntentos = entry.intentos + 1;
    const esDeadLetter = nuevoIntentos >= entry.maxIntentos;
    const backoffMs = esDeadLetter ? 0 : Math.min(1_000 * Math.pow(2, nuevoIntentos - 1), 3_600_000);

    await this.dbService.appDb
      .update(outbox)
      .set({
        estado: esDeadLetter ? 'fallido' : 'pendiente',
        intentos: nuevoIntentos,
        proximoIntentoEn: new Date(Date.now() + backoffMs),
        errorUltimo: err instanceof Error ? err.message : String(err),
      })
      .where(eq(outbox.id, entry.id));

    if (esDeadLetter) {
      this.logger.error(
        `Outbox ${entry.id} (${entry.handlerNombre}) dead-letter tras ${nuevoIntentos} intentos`,
      );
    } else {
      this.logger.warn(
        `Outbox ${entry.id} (${entry.handlerNombre}) fallido — reintento en ${backoffMs}ms (intento ${nuevoIntentos}/${entry.maxIntentos})`,
      );
    }
  }
}
