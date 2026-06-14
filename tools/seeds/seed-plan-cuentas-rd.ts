/**
 * Seed: Plan de Cuentas República Dominicana + Regla consumo_material
 *
 * Inserta el plan de cuentas plantilla RD para la empresa demo y crea la
 * regla contable automática para el evento consumo_material:
 *   (DB) 5101 Costo de Obra en Proceso
 *   (CR) 1104.01 Inventario de Materiales
 *
 * Idempotente: usa ON CONFLICT DO NOTHING en todas las inserciones.
 *
 * Uso: pnpm --filter @tributia/api tsx ../../tools/seeds/seed-plan-cuentas-rd.ts
 * Env: DATABASE_URL (conexión admin, bypassa RLS)
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../apps/api/src/db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '../../packages/shared/src/index.js';
import type { ConfiguracionRegla } from '../../packages/contabilidad/src/index.js';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const db = drizzle(pool, { schema });

// ─── Tipos auxiliares ─────────────────────────────────────────────────────────

type Nivel = 1 | 2 | 3 | 4;
type TipoCuenta = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'costo' | 'gasto';
type Naturaleza = 'deudora' | 'acreedora';

interface CuentaPlantilla {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  naturaleza: Naturaleza;
  nivel: Nivel;
  codigoPadre?: string;
  esMovimiento: boolean;
}

// ─── Plan de cuentas RD (plantilla base constructora) ─────────────────────────

const PLAN_RD: CuentaPlantilla[] = [
  // ── GRUPO 1: ACTIVOS ──────────────────────────────────────────────────────
  { codigo: '1',       nombre: 'Activos',                         tipo: 'activo',    naturaleza: 'deudora',   nivel: 1, esMovimiento: false },
  { codigo: '11',      nombre: 'Activos Corrientes',              tipo: 'activo',    naturaleza: 'deudora',   nivel: 2, codigoPadre: '1',       esMovimiento: false },
  { codigo: '1101',    nombre: 'Efectivo y Equivalentes',         tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '11',      esMovimiento: false },
  { codigo: '1101.01', nombre: 'Caja General',                   tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1101',    esMovimiento: true  },
  { codigo: '1101.02', nombre: 'Bancos - BHD León',              tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1101',    esMovimiento: true  },
  { codigo: '1102',    nombre: 'Cuentas por Cobrar',             tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '11',      esMovimiento: false },
  { codigo: '1102.01', nombre: 'Clientes Constructoras',         tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1102',    esMovimiento: true  },
  { codigo: '1102.02', nombre: 'Anticipos a Proveedores',        tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1102',    esMovimiento: true  },
  { codigo: '1103',    nombre: 'ITBIS Anticipado',               tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '11',      esMovimiento: false },
  { codigo: '1103.01', nombre: 'ITBIS por Acreditar',            tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1103',    esMovimiento: true  },
  { codigo: '1104',    nombre: 'Inventarios',                    tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '11',      esMovimiento: false },
  { codigo: '1104.01', nombre: 'Inventario de Materiales',       tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1104',    esMovimiento: true  },
  { codigo: '1104.02', nombre: 'Herramientas y Equipos Menores', tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1104',    esMovimiento: true  },
  { codigo: '12',      nombre: 'Activos No Corrientes',          tipo: 'activo',    naturaleza: 'deudora',   nivel: 2, codigoPadre: '1',       esMovimiento: false },
  { codigo: '1201',    nombre: 'Propiedad, Planta y Equipo',     tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '12',      esMovimiento: false },
  { codigo: '1201.01', nombre: 'Maquinaria Pesada',              tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1201',    esMovimiento: true  },
  { codigo: '1201.02', nombre: 'Vehículos de Obra',              tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1201',    esMovimiento: true  },
  { codigo: '1202',    nombre: 'Obras en Proceso',               tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '12',      esMovimiento: false },
  { codigo: '1202.01', nombre: 'Proyectos en Construcción',      tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1202',    esMovimiento: true  },

  // ── GRUPO 2: PASIVOS ──────────────────────────────────────────────────────
  { codigo: '2',       nombre: 'Pasivos',                         tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 1, esMovimiento: false },
  { codigo: '21',      nombre: 'Pasivos Corrientes',              tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 2, codigoPadre: '2',       esMovimiento: false },
  { codigo: '2101',    nombre: 'Cuentas por Pagar',              tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 3, codigoPadre: '21',      esMovimiento: false },
  { codigo: '2101.01', nombre: 'Proveedores de Materiales',      tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 4, codigoPadre: '2101',    esMovimiento: true  },
  { codigo: '2101.02', nombre: 'Subcontratistas',                tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 4, codigoPadre: '2101',    esMovimiento: true  },
  { codigo: '2102',    nombre: 'Retenciones por Pagar',          tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 3, codigoPadre: '21',      esMovimiento: false },
  { codigo: '2102.01', nombre: 'TSS por Pagar',                  tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 4, codigoPadre: '2102',    esMovimiento: true  },
  { codigo: '2102.02', nombre: 'ISR Retenido 5%',                tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 4, codigoPadre: '2102',    esMovimiento: true  },
  { codigo: '2103',    nombre: 'ITBIS por Pagar',                tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 3, codigoPadre: '21',      esMovimiento: false },
  { codigo: '2103.01', nombre: 'ITBIS Cobrado a Clientes',       tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 4, codigoPadre: '2103',    esMovimiento: true  },

  // ── GRUPO 3: PATRIMONIO ───────────────────────────────────────────────────
  { codigo: '3',       nombre: 'Patrimonio',                      tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 1, esMovimiento: false },
  { codigo: '31',      nombre: 'Capital Social',                  tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 2, codigoPadre: '3',       esMovimiento: false },
  { codigo: '3101',    nombre: 'Capital Pagado',                  tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 3, codigoPadre: '31',      esMovimiento: false },
  { codigo: '3101.01', nombre: 'Capital Social Autorizado',       tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 4, codigoPadre: '3101',    esMovimiento: true  },
  { codigo: '32',      nombre: 'Utilidades',                      tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 2, codigoPadre: '3',       esMovimiento: false },
  { codigo: '3201',    nombre: 'Utilidades Acumuladas',           tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 3, codigoPadre: '32',      esMovimiento: false },
  { codigo: '3201.01', nombre: 'Utilidades del Ejercicio',        tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 4, codigoPadre: '3201',    esMovimiento: true  },

  // ── GRUPO 4: INGRESOS ─────────────────────────────────────────────────────
  { codigo: '4',       nombre: 'Ingresos',                        tipo: 'ingreso',   naturaleza: 'acreedora', nivel: 1, esMovimiento: false },
  { codigo: '41',      nombre: 'Ingresos Operacionales',          tipo: 'ingreso',   naturaleza: 'acreedora', nivel: 2, codigoPadre: '4',       esMovimiento: false },
  { codigo: '4101',    nombre: 'Contratos de Construcción',       tipo: 'ingreso',   naturaleza: 'acreedora', nivel: 3, codigoPadre: '41',      esMovimiento: false },
  { codigo: '4101.01', nombre: 'Ingresos por Avance de Obra',     tipo: 'ingreso',   naturaleza: 'acreedora', nivel: 4, codigoPadre: '4101',    esMovimiento: true  },
  { codigo: '4101.02', nombre: 'Ingresos por Servicios Técnicos', tipo: 'ingreso',   naturaleza: 'acreedora', nivel: 4, codigoPadre: '4101',    esMovimiento: true  },

  // ── GRUPO 5: COSTOS Y GASTOS ──────────────────────────────────────────────
  { codigo: '5',       nombre: 'Costos y Gastos',                 tipo: 'costo',     naturaleza: 'deudora',   nivel: 1, esMovimiento: false },
  { codigo: '51',      nombre: 'Costos de Contratos',             tipo: 'costo',     naturaleza: 'deudora',   nivel: 2, codigoPadre: '5',       esMovimiento: false },
  { codigo: '5101',    nombre: 'Costo de Obra en Proceso',        tipo: 'costo',     naturaleza: 'deudora',   nivel: 3, codigoPadre: '51',      esMovimiento: true  },
  { codigo: '5102',    nombre: 'Costo de Mano de Obra',           tipo: 'costo',     naturaleza: 'deudora',   nivel: 3, codigoPadre: '51',      esMovimiento: true  },
  { codigo: '5103',    nombre: 'Costo de Equipos',                tipo: 'costo',     naturaleza: 'deudora',   nivel: 3, codigoPadre: '51',      esMovimiento: true  },
  { codigo: '5104',    nombre: 'Subcontratos',                    tipo: 'costo',     naturaleza: 'deudora',   nivel: 3, codigoPadre: '51',      esMovimiento: true  },
  { codigo: '52',      nombre: 'Gastos Administrativos',          tipo: 'gasto',     naturaleza: 'deudora',   nivel: 2, codigoPadre: '5',       esMovimiento: false },
  { codigo: '5201',    nombre: 'Sueldos y Salarios Admin',        tipo: 'gasto',     naturaleza: 'deudora',   nivel: 3, codigoPadre: '52',      esMovimiento: true  },
  { codigo: '5202',    nombre: 'Alquileres',                      tipo: 'gasto',     naturaleza: 'deudora',   nivel: 3, codigoPadre: '52',      esMovimiento: true  },
  { codigo: '5203',    nombre: 'Servicios Profesionales',         tipo: 'gasto',     naturaleza: 'deudora',   nivel: 3, codigoPadre: '52',      esMovimiento: true  },
];

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Obtener tenant y empresa de demo (deben existir, creados por seed-perfiles.ts)
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.rncCedula, '101-00001-1'))
    .limit(1);

  if (!tenant) {
    console.error('Tenant demo no encontrado. Ejecuta seed-perfiles.ts primero.');
    process.exit(1);
  }

  const [empresa] = await db
    .select()
    .from(schema.empresas)
    .where(and(eq(schema.empresas.tenantId, tenant.id), eq(schema.empresas.activo, true)))
    .limit(1);

  if (!empresa) {
    console.error('Empresa demo no encontrada. Ejecuta seed-perfiles.ts primero.');
    process.exit(1);
  }

  console.log(`Tenant: ${tenant.nombre} (${tenant.id})`);
  console.log(`Empresa: ${empresa.nombre} (${empresa.id})`);

  // Construir mapa código → id para referencias a padres
  const codigoAId = new Map<string, string>();

  console.log(`\nInsertando ${PLAN_RD.length} cuentas...`);
  for (const cuenta of PLAN_RD) {
    const id = newId();
    const padreId = cuenta.codigoPadre ? codigoAId.get(cuenta.codigoPadre) : undefined;

    await db
      .insert(schema.cuentasContables)
      .values({
        id,
        tenantId: tenant.id,
        empresaId: empresa.id,
        codigo: cuenta.codigo,
        nombre: cuenta.nombre,
        tipo: cuenta.tipo,
        naturaleza: cuenta.naturaleza,
        nivel: cuenta.nivel,
        padreId: padreId ?? null,
        esMovimiento: cuenta.esMovimiento,
        activo: true,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .onConflictDoNothing();

    codigoAId.set(cuenta.codigo, id);
  }
  console.log('Plan de cuentas insertado.');

  // ── Regla contable: consumo_material ──────────────────────────────────────
  console.log('\nCreando regla contable para consumo_material...');

  const configuracion: ConfiguracionRegla = {
    lineas: [
      {
        tipo: 'debito',
        cuentaCodigo: '5101',
        descripcion: 'Costo de obra en proceso — consumo de materiales',
      },
      {
        tipo: 'credito',
        cuentaCodigo: '1104.01',
        descripcion: 'Salida de inventario de materiales',
      },
    ],
  };

  await db
    .insert(schema.reglasContables)
    .values({
      id: newId(),
      tenantId: tenant.id,
      empresaId: empresa.id,
      tipoEvento: 'consumo_material',
      nombre: 'Consumo de Material → Costo Obra en Proceso',
      descripcion:
        'Registra la salida de inventario de materiales como costo de obra en proceso al consumirlos en campo.',
      configuracion,
      prioridad: 0,
      activo: true,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    })
    .onConflictDoNothing();

  console.log('Regla contable creada.');
  console.log('\nSeed completado exitosamente.');
}

main()
  .catch((err) => {
    console.error('Error en seed:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
