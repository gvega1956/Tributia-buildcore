import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema/index.js';
import { dbContext, type AppTransaction } from './database.context.js';

export type AppDb = NodePgDatabase<typeof schema>;

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);

  /** Pool admin (rol 'tributia', dueño de tablas → bypassa RLS). Usar solo en seeds/admin. */
  private adminPool!: Pool;
  /** Pool de aplicación (rol 'tributia_app', sujeto a RLS). */
  private appPool!: Pool;

  private _adminDb!: AppDb;
  private _appDb!: AppDb;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.adminPool = new Pool({
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
    });
    this.appPool = new Pool({
      connectionString: this.config.getOrThrow<string>('DATABASE_URL_APP'),
    });

    this._adminDb = drizzle(this.adminPool, { schema });
    this._appDb = drizzle(this.appPool, { schema });

    this.logger.log('Pools de base de datos inicializados');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.adminPool.end(), this.appPool.end()]);
  }

  /**
   * Drizzle sobre el pool admin (bypassa RLS).
   * USO RESTRINGIDO: seeds, herramientas admin, operaciones system-level.
   */
  get adminDb(): AppDb {
    return this._adminDb;
  }

  /**
   * Drizzle bruto sobre el pool de aplicación (sin transacción).
   * El TenancyInterceptor lo usa para abrir la transacción de cada request.
   * Los servicios NO deben usar este getter directamente — usar `tx`.
   */
  get appDb(): AppDb {
    return this._appDb;
  }

  /**
   * Drizzle sobre el pool de aplicación.
   * Si hay una transacción activa en el contexto (puesta por TenancyInterceptor),
   * la devuelve. De lo contrario devuelve el db sin transacción.
   *
   * Los servicios deben usar SIEMPRE este getter — nunca adminDb directamente.
   */
  get tx(): AppDb | AppTransaction {
    return dbContext.getStore()?.tx ?? this._appDb;
  }
}
