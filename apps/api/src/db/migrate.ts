/**
 * Runner de migraciones — ejecutar con `pnpm db:migrate`.
 * Conecta como 'tributia' (dueño de tablas, bypassa RLS).
 * Las migraciones viven en src/db/migrations/*.sql.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'path';

async function main(): Promise<void> {
  const url =
    process.env['DATABASE_URL'] ??
    'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  const migrationsFolder = path.join(__dirname, 'migrations');
  console.log('Aplicando migraciones desde', migrationsFolder);

  await migrate(db, { migrationsFolder });

  console.log('Migraciones aplicadas correctamente.');
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('Error en migraciones:', err);
  process.exit(1);
});
