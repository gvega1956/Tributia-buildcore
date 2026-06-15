import {
  pgTable,
  uuid,
  numeric,
  text,
  index,
} from 'drizzle-orm/pg-core';
import { newId } from '@tributia/shared';
import { tenants } from '../core/tenant.js';
import { partesDiario } from './parte_diario.js';
import { archivos } from '../documental/archivo.js';
import { auditColumns } from '../core/audit.js';

/**
 * foto_parte — foto georreferenciada adjunta al parte diario.
 *
 * El archivo binario vive en S3/MinIO; aquí solo el puntero y las coordenadas.
 * latitud/longitud capturadas en campo por la app móvil (GPS del dispositivo).
 */
export const fotosParte = pgTable(
  'foto_parte',
  {
    id: uuid('id').primaryKey().$defaultFn(() => newId()),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    parteId: uuid('parte_id')
      .notNull()
      .references(() => partesDiario.id),

    archivoId: uuid('archivo_id')
      .notNull()
      .references(() => archivos.id),

    latitud: numeric('latitud', { precision: 10, scale: 7 }),

    longitud: numeric('longitud', { precision: 10, scale: 7 }),

    descripcion: text('descripcion'),

    ...auditColumns,
  },
  (t) => ({
    tenantIdx: index('foto_parte_tenant_idx').on(t.tenantId),
    parteIdx: index('foto_parte_parte_idx').on(t.parteId),
  }),
);

export type FotoParteInsert = typeof fotosParte.$inferInsert;
export type FotoParteSelect = typeof fotosParte.$inferSelect;
