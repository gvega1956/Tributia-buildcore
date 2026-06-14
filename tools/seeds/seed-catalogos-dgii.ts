/**
 * Seed: Catálogos DGII + Unidades de medida estándar
 *
 * Siembra:
 *   - Tipos e-CF (e31–e47) según normas DGII República Dominicana
 *   - Tasas ITBIS vigentes (18%, 16% reducida, 0% exento)
 *   - Tipos de retención fiscal (ISR, ITBIS, gubernamental)
 *   - Unidades de medida estándar para el tenant demo
 *
 * Idempotente: ON CONFLICT DO NOTHING en todas las inserciones.
 *
 * Uso: pnpm --filter @tributia/api tsx ../../tools/seeds/seed-catalogos-dgii.ts
 * Env: DATABASE_URL (admin, bypassa RLS) · DATABASE_TENANT_ID (para unidades)
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schema from '../../apps/api/src/db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '../../packages/shared/src/index.js';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const db = drizzle(pool, { schema });

// ─── 1. Tipos e-CF ──────────────────────────────────────────────────────────

const TIPOS_ECF = [
  { codigo: 'e31', nombre: 'Factura de Crédito Fiscal', descripcion: 'Para ventas a empresas con valor fiscal. Sustenta crédito ITBIS.' },
  { codigo: 'e32', nombre: 'Factura de Consumo', descripcion: 'Para ventas a consumidores finales. Sin crédito ITBIS.' },
  { codigo: 'e33', nombre: 'Nota de Débito', descripcion: 'Ajuste que incrementa el valor de una transacción anterior.' },
  { codigo: 'e34', nombre: 'Nota de Crédito', descripcion: 'Ajuste que disminuye el valor de una transacción anterior, devoluciones y descuentos.' },
  { codigo: 'e41', nombre: 'Comprobante de Compras', descripcion: 'Para registrar compras a proveedores informales no obligados a emitir e-CF.' },
  { codigo: 'e43', nombre: 'Registro de Gastos Menores', descripcion: 'Para gastos menores del giro del negocio (tope DGII: RD$250).' },
  { codigo: 'e44', nombre: 'Regímenes Especiales de Producción', descripcion: 'Para operaciones de zonas francas y regímenes especiales.' },
  { codigo: 'e45', nombre: 'Gubernamentales', descripcion: 'Para transacciones con instituciones del gobierno dominicano.' },
  { codigo: 'e46', nombre: 'Comprobante para Exportaciones', descripcion: 'Para facturar exportaciones de bienes y servicios.' },
  { codigo: 'e47', nombre: 'Comprobante para Pagos al Exterior', descripcion: 'Para documentar pagos a proveedores o prestadores de servicios en el exterior.' },
];

// ─── 2. Tasas ITBIS ─────────────────────────────────────────────────────────

const TASAS_ITBIS = [
  { codigo: 'ITBIS_18', porcentaje: '18.00', descripcion: 'ITBIS tasa general (18%) — bienes y servicios gravados estándar' },
  { codigo: 'ITBIS_16', porcentaje: '16.00', descripcion: 'ITBIS tasa reducida (16%) — productos agropecuarios y de primera necesidad seleccionados' },
  { codigo: 'ITBIS_0_EXENTO', porcentaje: '0.00', descripcion: 'Exento de ITBIS — productos básicos, medicamentos, servicios educativos y salud' },
];

// ─── 3. Tipos de retención ──────────────────────────────────────────────────

const TIPOS_RETENCION = [
  { codigo: 'ISR_PERSONAS_FISICAS_10', nombre: 'ISR Personas Físicas 10%', porcentaje: '10.00', aplicaA: 'SERVICIOS' as const, descripcion: 'Retención ISR aplicable a pagos a personas físicas (art. 309 Código Tributario)' },
  { codigo: 'ISR_SERVICIOS_TECNICOS_10', nombre: 'ISR Servicios Técnicos 10%', porcentaje: '10.00', aplicaA: 'SERVICIOS' as const, descripcion: 'Retención sobre servicios técnicos, honorarios y comisiones a personas jurídicas' },
  { codigo: 'ISR_ESTADO_5PCT', nombre: 'ISR Pagos del Estado 5%', porcentaje: '5.00', aplicaA: 'AMBOS' as const, descripcion: 'Retención del 5% aplicada por instituciones del Estado dominicano a sus proveedores' },
  { codigo: 'ITBIS_SERVICIOS_PROF_30', nombre: 'Retención ITBIS Servicios Profesionales 30%', porcentaje: '30.00', aplicaA: 'SERVICIOS' as const, descripcion: 'Retención del 30% del ITBIS en pagos a personas físicas por servicios profesionales independientes' },
  { codigo: 'ITBIS_SERVICIOS_GOB_100', nombre: 'Retención ITBIS Gobierno 100%', porcentaje: '100.00', aplicaA: 'SERVICIOS' as const, descripcion: 'Retención total del ITBIS por instituciones gubernamentales en pagos a sus proveedores' },
];

// ─── 4. Unidades de medida estándar (para construcción RD) ──────────────────

const UNIDADES_STD = [
  { codigo: 'UN',  nombre: 'Unidad',               descripcion: 'Unidad genérica de conteo' },
  { codigo: 'KG',  nombre: 'Kilogramo',             descripcion: 'Masa en kilogramos' },
  { codigo: 'M',   nombre: 'Metro lineal',          descripcion: 'Longitud en metros' },
  { codigo: 'M2',  nombre: 'Metro cuadrado',        descripcion: 'Área en metros cuadrados' },
  { codigo: 'M3',  nombre: 'Metro cúbico',          descripcion: 'Volumen en metros cúbicos' },
  { codigo: 'ML',  nombre: 'Metro lineal',          descripcion: 'Alias ML para metros lineales' },
  { codigo: 'GL',  nombre: 'Galón',                descripcion: 'Galón (combustibles y líquidos)' },
  { codigo: 'LT',  nombre: 'Litro',                descripcion: 'Volumen en litros' },
  { codigo: 'SC',  nombre: 'Saco',                 descripcion: 'Saco de materiales (cemento 42.5 kg)' },
  { codigo: 'TN',  nombre: 'Tonelada métrica',     descripcion: '1 TN = 1000 KG' },
  { codigo: 'HR',  nombre: 'Hora',                 descripcion: 'Hora de trabajo o equipo' },
  { codigo: 'DIA', nombre: 'Día',                  descripcion: 'Jornada laboral o alquiler de equipo' },
  { codigo: 'GLB', nombre: 'Global',               descripcion: 'Ítem que se cotiza de forma global' },
  { codigo: 'JGO', nombre: 'Juego',                descripcion: 'Conjunto de piezas relacionadas' },
  { codigo: 'PZA', nombre: 'Pieza',                descripcion: 'Pieza individual' },
  { codigo: 'RLL', nombre: 'Rollo',                descripcion: 'Rollo de material (alambre, tubo flexible, etc.)' },
];

async function main() {
  console.log('Sembrando catálogos DGII...');

  // ── tipos_ecf ──────────────────────────────────────────────────────────────
  for (const t of TIPOS_ECF) {
    await db
      .insert(schema.tiposEcf)
      .values({
        id: newId(),
        codigo: t.codigo,
        nombre: t.nombre,
        descripcion: t.descripcion,
        validoDesde: '2019-01-01',
      })
      .onConflictDoNothing();
  }
  console.log(`  ✓ ${TIPOS_ECF.length} tipos e-CF`);

  // ── tasas_itbis ────────────────────────────────────────────────────────────
  for (const t of TASAS_ITBIS) {
    await db
      .insert(schema.tasasItbis)
      .values({
        id: newId(),
        codigo: t.codigo,
        porcentaje: t.porcentaje,
        descripcion: t.descripcion,
        validoDesde: '2019-01-01',
      })
      .onConflictDoNothing();
  }
  console.log(`  ✓ ${TASAS_ITBIS.length} tasas ITBIS`);

  // ── tipos_retencion ────────────────────────────────────────────────────────
  for (const t of TIPOS_RETENCION) {
    await db
      .insert(schema.tiposRetencion)
      .values({
        id: newId(),
        codigo: t.codigo,
        nombre: t.nombre,
        porcentaje: t.porcentaje,
        aplicaA: t.aplicaA,
        descripcion: t.descripcion,
        validoDesde: '2019-01-01',
      })
      .onConflictDoNothing();
  }
  console.log(`  ✓ ${TIPOS_RETENCION.length} tipos retención`);

  // ── unidades de medida (require tenant) ───────────────────────────────────
  const tenantId = process.env['DATABASE_TENANT_ID'];
  if (!tenantId) {
    console.log('  ⚠ DATABASE_TENANT_ID no definido — omitiendo unidades de medida');
  } else {
    const [tenant] = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      console.log(`  ⚠ Tenant '${tenantId}' no encontrado — omitiendo unidades de medida`);
    } else {
      for (const u of UNIDADES_STD) {
        await db
          .insert(schema.unidadesMedida)
          .values({
            id: newId(),
            tenantId,
            codigo: u.codigo,
            nombre: u.nombre,
            descripcion: u.descripcion,
            createdAt: new Date(),
            createdBy: SYSTEM_USER_ID,
            updatedAt: new Date(),
            updatedBy: SYSTEM_USER_ID,
          })
          .onConflictDoNothing();
      }
      console.log(`  ✓ ${UNIDADES_STD.length} unidades de medida → tenant ${tenantId}`);
    }
  }

  console.log('Catálogos DGII sembrados.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
