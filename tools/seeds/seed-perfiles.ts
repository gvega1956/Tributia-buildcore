/**
 * Seed: perfiles plantilla de roles para Tributia BuildCore
 *
 * Crea (si no existe) el tenant de demo y sus 6 perfiles de sistema.
 * Idempotente: puede ejecutarse varias veces sin duplicar datos.
 *
 * Uso: pnpm --filter @tributia/api tsx ../../tools/seeds/seed-perfiles.ts
 * Env:  DATABASE_URL (conexión admin, bypassa RLS)
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, and } from 'drizzle-orm';
import * as argon2 from 'argon2';
import * as schema from '../../apps/api/src/db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '../../packages/shared/src/index.js';
import { PERMISSIONS } from '../../packages/core/src/permissions/permissions.catalog.js';
import type { PermissionCode } from '../../packages/core/src/permissions/permissions.catalog.js';

// ─── Perfiles y sus permisos ─────────────────────────────────────────────────

type Perfil = {
  nombre: string;
  descripcion: string;
  permisos: PermissionCode[];
};

const PERFILES: Perfil[] = [
  {
    nombre: 'Administrador',
    descripcion: 'Acceso completo a todas las funciones del sistema.',
    permisos: Object.values(PERMISSIONS) as PermissionCode[],
  },
  {
    nombre: 'Residente de Obra',
    descripcion: 'Control de la ejecución física del proyecto: parte diario, avance, RFI, recepciones.',
    permisos: [
      PERMISSIONS.PROYECTO_READ,
      PERMISSIONS.EDT_READ,
      PERMISSIONS.PARTE_DIARIO_WRITE,
      PERMISSIONS.AVANCE_WRITE,
      PERMISSIONS.RFI_WRITE,
      PERMISSIONS.INVENTARIO_READ,
      PERMISSIONS.RECEPCION_WRITE,
      PERMISSIONS.REQUISICION_CREATE,
      PERMISSIONS.REPORTE_EJECUTIVO,
    ],
  },
  {
    nombre: 'Almacenista',
    descripcion: 'Gestión de almacenes, entradas, salidas y ajustes de inventario.',
    permisos: [
      PERMISSIONS.INVENTARIO_READ,
      PERMISSIONS.INVENTARIO_WRITE,
      PERMISSIONS.AJUSTE_INVENTARIO,
      PERMISSIONS.RECEPCION_WRITE,
      PERMISSIONS.REQUISICION_CREATE,
      PERMISSIONS.PROYECTO_READ,
    ],
  },
  {
    nombre: 'Contador',
    descripcion: 'Contabilidad, nómina, reportes financieros y cierre contable.',
    permisos: [
      PERMISSIONS.ASIENTO_READ,
      PERMISSIONS.ASIENTO_MANUAL,
      PERMISSIONS.CIERRE_CONTABLE,
      PERMISSIONS.NOMINA_READ,
      PERMISSIONS.REPORTE_FINANCIERO,
      PERMISSIONS.REPORTE_EJECUTIVO,
      PERMISSIONS.PROYECTO_READ,
      PERMISSIONS.OC_READ,
    ],
  },
  {
    nombre: 'Compras',
    descripcion: 'Ciclo completo de compras: requisición, cotización, OC, recepción.',
    permisos: [
      PERMISSIONS.REQUISICION_CREATE,
      PERMISSIONS.OC_READ,
      PERMISSIONS.OC_WRITE,
      PERMISSIONS.OC_APPROVE,
      PERMISSIONS.RECEPCION_WRITE,
      PERMISSIONS.PROYECTO_READ,
      PERMISSIONS.EDT_READ,
      PERMISSIONS.INVENTARIO_READ,
    ],
  },
  {
    nombre: 'Solo Lectura',
    descripcion: 'Visibilidad de proyectos, reportes y tableros sin capacidad de modificar.',
    permisos: [
      PERMISSIONS.PROYECTO_READ,
      PERMISSIONS.EDT_READ,
      PERMISSIONS.INVENTARIO_READ,
      PERMISSIONS.ASIENTO_READ,
      PERMISSIONS.NOMINA_READ,
      PERMISSIONS.REPORTE_EJECUTIVO,
      PERMISSIONS.OC_READ,
    ],
  },
];

// ─── Demo tenant / empresa / usuario ─────────────────────────────────────────

const DEMO_SLUG = 'demo';
const DEMO_TENANT_NOMBRE = 'Constructora Demo S.A.';
const DEMO_EMPRESA_NOMBRE = 'Constructora Demo S.A.';
const DEMO_EMPRESA_RNC = '101000001';
const DEMO_ADMIN_EMAIL = 'admin@demo.com';
const DEMO_ADMIN_PASSWORD = 'Admin!2025';

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const url =
    process.env['DATABASE_URL'] ??
    'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  console.log('→ Iniciando seed de perfiles plantilla...');

  // 1. Tenant demo
  let [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, DEMO_SLUG));

  if (!tenant) {
    const tenantId = newId();
    [tenant] = await db
      .insert(schema.tenants)
      .values({
        id: tenantId,
        nombre: DEMO_TENANT_NOMBRE,
        slug: DEMO_SLUG,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning();
    console.log(`  ✓ Tenant demo creado: ${tenantId}`);
  } else {
    console.log(`  · Tenant demo existe: ${tenant.id}`);
  }

  const tenantId = tenant.id;

  // 2. Empresa demo
  let [empresa] = await db
    .select()
    .from(schema.empresas)
    .where(and(eq(schema.empresas.tenantId, tenantId), eq(schema.empresas.nombre, DEMO_EMPRESA_NOMBRE)));

  if (!empresa) {
    const empresaId = newId();
    [empresa] = await db
      .insert(schema.empresas)
      .values({
        id: empresaId,
        tenantId,
        nombre: DEMO_EMPRESA_NOMBRE,
        rnc: DEMO_EMPRESA_RNC,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning();
    console.log(`  ✓ Empresa demo creada: ${empresaId}`);
  } else {
    console.log(`  · Empresa demo existe: ${empresa.id}`);
  }

  const empresaId = empresa.id;

  // 3. Roles plantilla
  const rolIds: Record<string, string> = {};
  for (const perfil of PERFILES) {
    const [existing] = await db
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.nombre, perfil.nombre), eq(schema.roles.tenantId, tenantId)));

    let rolId: string;
    if (!existing) {
      rolId = newId();
      await db.insert(schema.roles).values({
        id: rolId,
        tenantId,
        nombre: perfil.nombre,
        descripcion: perfil.descripcion,
        esSistema: true,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      });
      console.log(`  ✓ Rol creado: ${perfil.nombre}`);
    } else {
      rolId = existing.id;
      console.log(`  · Rol existe: ${perfil.nombre}`);
    }
    rolIds[perfil.nombre] = rolId;

    // 4. Permisos del rol (idempotente: ignorar conflictos)
    for (const permiso of perfil.permisos) {
      await db
        .insert(schema.rolPermisos)
        .values({ rolId, permiso, tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID })
        .onConflictDoNothing();
    }
  }

  // 5. Usuario admin demo
  let [adminUser] = await db
    .select()
    .from(schema.usuarios)
    .where(and(eq(schema.usuarios.email, DEMO_ADMIN_EMAIL), eq(schema.usuarios.tenantId, tenantId)));

  if (!adminUser) {
    const passwordHash = await argon2.hash(DEMO_ADMIN_PASSWORD, { type: argon2.argon2id });
    const userId = newId();
    [adminUser] = await db
      .insert(schema.usuarios)
      .values({
        id: userId,
        tenantId,
        email: DEMO_ADMIN_EMAIL,
        passwordHash,
        nombre: 'Admin',
        apellido: 'Demo',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning();
    console.log(`  ✓ Usuario admin creado: ${userId}`);
  } else {
    console.log(`  · Usuario admin existe: ${adminUser.id}`);
  }

  // 6. Asignar rol Administrador al usuario demo
  const adminRolId = rolIds['Administrador'];
  if (adminRolId) {
    await db
      .insert(schema.usuarioRolEmpresa)
      .values({
        id: newId(),
        tenantId,
        usuarioId: adminUser.id,
        empresaId,
        rolId: adminRolId,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .onConflictDoNothing();
    console.log(`  ✓ Rol Administrador asignado al usuario demo`);
  }

  console.log('\n✓ Seed completado correctamente.');
  console.log(`\n  Login demo:\n    Tenant: ${DEMO_SLUG}\n    Email:  ${DEMO_ADMIN_EMAIL}\n    Pass:   ${DEMO_ADMIN_PASSWORD}`);

  await pool.end();
}

main().catch((err: unknown) => {
  console.error('Error en seed:', err);
  process.exit(1);
});
