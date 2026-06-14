import { config } from 'dotenv';
import { resolve } from 'path';

// Cargar .env desde la raíz del monorepo antes que cualquier módulo NestJS
// (NestJS ConfigModule usa process.env, no import.meta.env)
config({ path: resolve(__dirname, '../../../.env') });
config({ path: resolve(__dirname, '../../../.env.local'), override: false });
