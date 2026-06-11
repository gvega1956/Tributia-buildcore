import { AsyncLocalStorage } from 'async_hooks';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type * as schema from '../db/schema/index.js';

/** Tipo de transacción Drizzle para PostgreSQL con el schema completo. */
export type AppTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export interface DatabaseStore {
  tx: AppTransaction;
  tenantId: string;
}

/**
 * Almacenamiento por contexto de ejecución asíncrona.
 * El TenancyInterceptor deposita la transacción aquí.
 * Los servicios llaman a DbService.tx para obtenerla sin recibirla como parámetro.
 */
export const dbContext = new AsyncLocalStorage<DatabaseStore>();
