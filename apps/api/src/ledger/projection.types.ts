import type { AppDb } from '../database/db.service.js';
import type { AppTransaction } from '../database/database.context.js';
import type { EventoOperativoSelect } from '../db/schema/ledger/evento_operativo.js';

export type DbTx = AppDb | AppTransaction;

export interface ProjectionContext {
  evento: EventoOperativoSelect;
  tx: DbTx;
}

export interface ProjectionHandler {
  readonly nombre: string;
  readonly tiposEvento: ReadonlyArray<string>;
  readonly modo: 'sincrono' | 'asincrono';
  ejecutar(ctx: ProjectionContext): Promise<void>;
}

export const PROJECTION_HANDLER_TOKEN = Symbol('PROJECTION_HANDLER_TOKEN');
