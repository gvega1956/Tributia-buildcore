/**
 * Seed de demo completo — Tributia BuildCore
 *
 * Siembra en un único script idempotente:
 *   1. Tenant  "Constructora Demo RD"  (slug: demo-rd)
 *   2. 2 Empresas con RNCs distintos
 *   3. Catálogos DGII: tipos e-CF, tasas ITBIS, tipos retención
 *   4. Unidades de medida estándar construcción RD
 *   5. 6 roles con sus permisos (Admin, Residente, Almacenista, Contador, Compras, Solo Lectura)
 *   6. 6 usuarios (uno por perfil)
 *   7. Plan de cuentas RD + regla contable consumo_material para Empresa Principal
 *   8. Catálogo de insumos demostrativos (cemento, varilla, block, arena, grava)
 *   9. Centro de costo + evento consumo_material (flujo canónico §5 arquitectura)
 *  10. Asiento contable automático del evento: DB 5101 / CR 1104.01
 *
 * Idempotente: todas las inserciones usan ON CONFLICT DO NOTHING.
 * Orden: puede ejecutarse varias veces sin duplicar datos.
 *
 * Uso: pnpm --filter @tributia/api tsx ../../tools/seeds/seed-demo.ts
 * Env: DATABASE_URL (admin, bypasa RLS)
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
import type { ConfiguracionRegla } from '../../packages/contabilidad/src/index.js';

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

const pool = new Pool({ connectionString: ADMIN_URL });
const db = drizzle(pool, { schema });

// ─── Constantes demo ──────────────────────────────────────────────────────────

const DEMO_SLUG = 'demo-rd';
const DEMO_TENANT_NOMBRE = 'Constructora Demo RD';
const EMPRESA_PRINCIPAL = { nombre: 'Constructora Demo S.A.',     rnc: '101000001' };
const EMPRESA_SECUNDARIA = { nombre: 'Inmobiliaria Demo S.R.L.',  rnc: '101000002' };

// ─── Catálogos DGII ───────────────────────────────────────────────────────────

const TIPOS_ECF = [
  { codigo: 'e31', nombre: 'Factura de Crédito Fiscal',            descripcion: 'Ventas a empresas — sustenta crédito ITBIS.' },
  { codigo: 'e32', nombre: 'Factura de Consumo',                   descripcion: 'Ventas a consumidores finales.' },
  { codigo: 'e33', nombre: 'Nota de Débito',                       descripcion: 'Ajuste que incrementa valor de transacción.' },
  { codigo: 'e34', nombre: 'Nota de Crédito',                      descripcion: 'Devoluciones y descuentos.' },
  { codigo: 'e41', nombre: 'Comprobante de Compras',               descripcion: 'Compras a proveedores informales.' },
  { codigo: 'e43', nombre: 'Registro de Gastos Menores',           descripcion: 'Gastos menores hasta RD$250.' },
  { codigo: 'e44', nombre: 'Regímenes Especiales de Producción',   descripcion: 'Zonas francas y regímenes especiales.' },
  { codigo: 'e45', nombre: 'Gubernamentales',                      descripcion: 'Transacciones con instituciones del Estado.' },
  { codigo: 'e46', nombre: 'Comprobante para Exportaciones',       descripcion: 'Facturación de exportaciones.' },
  { codigo: 'e47', nombre: 'Comprobante para Pagos al Exterior',   descripcion: 'Pagos a proveedores extranjeros.' },
];

const TASAS_ITBIS = [
  { codigo: 'ITBIS_18',      porcentaje: '18.00', descripcion: 'ITBIS tasa general (18%)' },
  { codigo: 'ITBIS_16',      porcentaje: '16.00', descripcion: 'ITBIS reducida (16%) — agropecuarios' },
  { codigo: 'ITBIS_0_EXENTO', porcentaje: '0.00', descripcion: 'Exento de ITBIS' },
];

const TIPOS_RETENCION = [
  { codigo: 'ISR_PERSONAS_FISICAS_10', nombre: 'ISR Personas Físicas 10%',             porcentaje: '10.00', aplicaA: 'SERVICIOS' as const, descripcion: 'Retención ISR art.309 CT' },
  { codigo: 'ISR_SERVICIOS_TECNICOS_10', nombre: 'ISR Servicios Técnicos 10%',         porcentaje: '10.00', aplicaA: 'SERVICIOS' as const, descripcion: 'Honorarios y comisiones personas jurídicas' },
  { codigo: 'ISR_ESTADO_5PCT',          nombre: 'ISR Pagos del Estado 5%',             porcentaje: '5.00',  aplicaA: 'AMBOS' as const,    descripcion: 'Retención 5% del Estado' },
  { codigo: 'ITBIS_SERVICIOS_PROF_30',  nombre: 'Retención ITBIS Servicios Profesionales 30%', porcentaje: '30.00', aplicaA: 'SERVICIOS' as const, descripcion: '30% del ITBIS a personas físicas' },
  { codigo: 'ITBIS_SERVICIOS_GOB_100',  nombre: 'Retención ITBIS Gobierno 100%',       porcentaje: '100.00', aplicaA: 'SERVICIOS' as const, descripcion: 'Retención total ITBIS por instituciones gubernamentales' },
];

// ─── Unidades de medida ───────────────────────────────────────────────────────

const UNIDADES_STD = [
  { codigo: 'UN',  nombre: 'Unidad',              descripcion: 'Unidad genérica de conteo' },
  { codigo: 'KG',  nombre: 'Kilogramo',            descripcion: 'Masa en kilogramos' },
  { codigo: 'M',   nombre: 'Metro lineal',         descripcion: 'Longitud en metros' },
  { codigo: 'M2',  nombre: 'Metro cuadrado',       descripcion: 'Área en metros cuadrados' },
  { codigo: 'M3',  nombre: 'Metro cúbico',         descripcion: 'Volumen en metros cúbicos' },
  { codigo: 'GL',  nombre: 'Galón',                descripcion: 'Galón (combustibles y líquidos)' },
  { codigo: 'LT',  nombre: 'Litro',                descripcion: 'Volumen en litros' },
  { codigo: 'SC',  nombre: 'Saco',                 descripcion: 'Saco 42.5 kg (cemento estándar)' },
  { codigo: 'TN',  nombre: 'Tonelada métrica',     descripcion: '1 TN = 1000 KG' },
  { codigo: 'HR',  nombre: 'Hora',                 descripcion: 'Hora de trabajo o equipo' },
  { codigo: 'DIA', nombre: 'Día',                  descripcion: 'Jornada laboral o alquiler de equipo' },
  { codigo: 'GLB', nombre: 'Global',               descripcion: 'Ítem que se cotiza de forma global' },
  { codigo: 'PZA', nombre: 'Pieza',                descripcion: 'Pieza individual' },
  { codigo: 'RLL', nombre: 'Rollo',                descripcion: 'Rollo de material' },
  { codigo: 'BLS', nombre: 'Bolsa',                descripcion: 'Bolsa (áridos, aditivos)' },
];

// ─── Perfiles ──────────────────────────────────────────────────────────────────

type Perfil = { nombre: string; descripcion: string; permisos: PermissionCode[]; email: string; password: string; nombreReal: string; apellido: string };

const PERFILES: Perfil[] = [
  {
    nombre: 'Administrador',
    descripcion: 'Acceso completo a todas las funciones del sistema.',
    permisos: Object.values(PERMISSIONS) as PermissionCode[],
    email: 'admin@demo-rd.com',
    password: 'Admin!2025',
    nombreReal: 'Ana',
    apellido: 'Administrador Demo',
  },
  {
    nombre: 'Residente de Obra',
    descripcion: 'Control de ejecución física: parte diario, avance, recepciones.',
    permisos: [
      PERMISSIONS.PROYECTO_READ, PERMISSIONS.EDT_READ,
      PERMISSIONS.PARTE_DIARIO_WRITE, PERMISSIONS.AVANCE_WRITE, PERMISSIONS.RFI_WRITE,
      PERMISSIONS.INVENTARIO_READ, PERMISSIONS.RECEPCION_WRITE, PERMISSIONS.REQUISICION_CREATE,
      PERMISSIONS.REPORTE_EJECUTIVO,
    ],
    email: 'residente@demo-rd.com',
    password: 'Residente!2025',
    nombreReal: 'Carlos',
    apellido: 'Residente Demo',
  },
  {
    nombre: 'Almacenista',
    descripcion: 'Gestión de almacenes, entradas, salidas y ajustes de inventario.',
    permisos: [
      PERMISSIONS.INVENTARIO_READ, PERMISSIONS.INVENTARIO_WRITE, PERMISSIONS.AJUSTE_INVENTARIO,
      PERMISSIONS.RECEPCION_WRITE, PERMISSIONS.REQUISICION_CREATE, PERMISSIONS.PROYECTO_READ,
    ],
    email: 'almacenista@demo-rd.com',
    password: 'Almacen!2025',
    nombreReal: 'María',
    apellido: 'Almacenista Demo',
  },
  {
    nombre: 'Contador',
    descripcion: 'Contabilidad, nómina, reportes financieros y cierre contable.',
    permisos: [
      PERMISSIONS.ASIENTO_READ, PERMISSIONS.ASIENTO_MANUAL, PERMISSIONS.CIERRE_CONTABLE,
      PERMISSIONS.NOMINA_READ, PERMISSIONS.REPORTE_FINANCIERO, PERMISSIONS.REPORTE_EJECUTIVO,
      PERMISSIONS.PROYECTO_READ, PERMISSIONS.OC_READ,
    ],
    email: 'contador@demo-rd.com',
    password: 'Contad!2025',
    nombreReal: 'Juan',
    apellido: 'Contador Demo',
  },
  {
    nombre: 'Compras',
    descripcion: 'Ciclo completo de compras: requisición, cotización, OC, recepción.',
    permisos: [
      PERMISSIONS.REQUISICION_CREATE, PERMISSIONS.OC_READ, PERMISSIONS.OC_WRITE,
      PERMISSIONS.OC_APPROVE, PERMISSIONS.RECEPCION_WRITE,
      PERMISSIONS.PROYECTO_READ, PERMISSIONS.EDT_READ, PERMISSIONS.INVENTARIO_READ,
    ],
    email: 'compras@demo-rd.com',
    password: 'Compras!2025',
    nombreReal: 'Luisa',
    apellido: 'Compras Demo',
  },
  {
    nombre: 'Solo Lectura',
    descripcion: 'Visibilidad de proyectos y reportes sin capacidad de modificar.',
    permisos: [
      PERMISSIONS.PROYECTO_READ, PERMISSIONS.EDT_READ, PERMISSIONS.INVENTARIO_READ,
      PERMISSIONS.ASIENTO_READ, PERMISSIONS.NOMINA_READ, PERMISSIONS.REPORTE_EJECUTIVO,
      PERMISSIONS.OC_READ,
    ],
    email: 'lectura@demo-rd.com',
    password: 'Lectura!2025',
    nombreReal: 'Pedro',
    apellido: 'Lectura Demo',
  },
];

// ─── Plan de cuentas RD ───────────────────────────────────────────────────────

type Nivel = 1 | 2 | 3 | 4;
type TipoCuenta = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'costo' | 'gasto';
type Naturaleza = 'deudora' | 'acreedora';

interface CuentaPlantilla {
  codigo: string; nombre: string; tipo: TipoCuenta; naturaleza: Naturaleza;
  nivel: Nivel; codigoPadre?: string; esMovimiento: boolean;
}

const PLAN_RD: CuentaPlantilla[] = [
  // ACTIVOS
  { codigo: '1',       nombre: 'Activos',                         tipo: 'activo',    naturaleza: 'deudora',   nivel: 1, esMovimiento: false },
  { codigo: '11',      nombre: 'Activos Corrientes',              tipo: 'activo',    naturaleza: 'deudora',   nivel: 2, codigoPadre: '1',       esMovimiento: false },
  { codigo: '1101',    nombre: 'Efectivo y Equivalentes',         tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '11',      esMovimiento: false },
  { codigo: '1101.01', nombre: 'Caja General',                    tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1101',    esMovimiento: true  },
  { codigo: '1101.02', nombre: 'Bancos BHD León',                 tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1101',    esMovimiento: true  },
  { codigo: '1102',    nombre: 'Cuentas por Cobrar',              tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '11',      esMovimiento: false },
  { codigo: '1102.01', nombre: 'Clientes Constructoras',          tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1102',    esMovimiento: true  },
  { codigo: '1102.02', nombre: 'Anticipos a Proveedores',         tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1102',    esMovimiento: true  },
  { codigo: '1103',    nombre: 'ITBIS Anticipado',                tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '11',      esMovimiento: false },
  { codigo: '1103.01', nombre: 'ITBIS por Acreditar',             tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1103',    esMovimiento: true  },
  { codigo: '1104',    nombre: 'Inventarios',                     tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '11',      esMovimiento: false },
  { codigo: '1104.01', nombre: 'Inventario de Materiales',        tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1104',    esMovimiento: true  },
  { codigo: '1104.02', nombre: 'Herramientas y Equipos Menores',  tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1104',    esMovimiento: true  },
  { codigo: '1105',    nombre: 'Retenciones Sufridas por Cobrar', tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '11',      esMovimiento: false },
  { codigo: '1105.01', nombre: 'ISR Retenido por Clientes 5%',    tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1105',    esMovimiento: true  },
  { codigo: '1105.02', nombre: 'ITBIS Retenido por Clientes',     tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1105',    esMovimiento: true  },
  { codigo: '12',      nombre: 'Activos No Corrientes',           tipo: 'activo',    naturaleza: 'deudora',   nivel: 2, codigoPadre: '1',       esMovimiento: false },
  { codigo: '1201',    nombre: 'Propiedad Planta y Equipo',       tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '12',      esMovimiento: false },
  { codigo: '1201.01', nombre: 'Maquinaria Pesada',               tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1201',    esMovimiento: true  },
  { codigo: '1202',    nombre: 'Obras en Proceso',                tipo: 'activo',    naturaleza: 'deudora',   nivel: 3, codigoPadre: '12',      esMovimiento: false },
  { codigo: '1202.01', nombre: 'Proyectos en Construcción',       tipo: 'activo',    naturaleza: 'deudora',   nivel: 4, codigoPadre: '1202',    esMovimiento: true  },
  // PASIVOS
  { codigo: '2',       nombre: 'Pasivos',                         tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 1, esMovimiento: false },
  { codigo: '21',      nombre: 'Pasivos Corrientes',              tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 2, codigoPadre: '2',       esMovimiento: false },
  { codigo: '2101',    nombre: 'Cuentas por Pagar',               tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 3, codigoPadre: '21',      esMovimiento: false },
  { codigo: '2101.01', nombre: 'Proveedores de Materiales',       tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 4, codigoPadre: '2101',    esMovimiento: true  },
  { codigo: '2101.02', nombre: 'Subcontratistas',                 tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 4, codigoPadre: '2101',    esMovimiento: true  },
  { codigo: '2102',    nombre: 'Retenciones por Pagar',           tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 3, codigoPadre: '21',      esMovimiento: false },
  { codigo: '2102.01', nombre: 'TSS por Pagar',                   tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 4, codigoPadre: '2102',    esMovimiento: true  },
  { codigo: '2102.02', nombre: 'ISR Retenido 5%',                 tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 4, codigoPadre: '2102',    esMovimiento: true  },
  { codigo: '2103',    nombre: 'ITBIS por Pagar',                 tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 3, codigoPadre: '21',      esMovimiento: false },
  { codigo: '2103.01', nombre: 'ITBIS Cobrado a Clientes',        tipo: 'pasivo',    naturaleza: 'acreedora', nivel: 4, codigoPadre: '2103',    esMovimiento: true  },
  // PATRIMONIO
  { codigo: '3',       nombre: 'Patrimonio',                      tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 1, esMovimiento: false },
  { codigo: '31',      nombre: 'Capital Social',                  tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 2, codigoPadre: '3',       esMovimiento: false },
  { codigo: '3101',    nombre: 'Capital Pagado',                  tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 3, codigoPadre: '31',      esMovimiento: false },
  { codigo: '3101.01', nombre: 'Capital Social Autorizado',       tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 4, codigoPadre: '3101',    esMovimiento: true  },
  { codigo: '32',      nombre: 'Utilidades',                      tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 2, codigoPadre: '3',       esMovimiento: false },
  { codigo: '3201',    nombre: 'Utilidades Acumuladas',           tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 3, codigoPadre: '32',      esMovimiento: false },
  { codigo: '3201.01', nombre: 'Utilidades del Ejercicio',        tipo: 'patrimonio', naturaleza: 'acreedora', nivel: 4, codigoPadre: '3201',    esMovimiento: true  },
  // INGRESOS
  { codigo: '4',       nombre: 'Ingresos',                        tipo: 'ingreso',   naturaleza: 'acreedora', nivel: 1, esMovimiento: false },
  { codigo: '41',      nombre: 'Ingresos Operacionales',          tipo: 'ingreso',   naturaleza: 'acreedora', nivel: 2, codigoPadre: '4',       esMovimiento: false },
  { codigo: '4101',    nombre: 'Contratos de Construcción',       tipo: 'ingreso',   naturaleza: 'acreedora', nivel: 3, codigoPadre: '41',      esMovimiento: false },
  { codigo: '4101.01', nombre: 'Ingresos por Avance de Obra',     tipo: 'ingreso',   naturaleza: 'acreedora', nivel: 4, codigoPadre: '4101',    esMovimiento: true  },
  { codigo: '4101.02', nombre: 'Ingresos por Servicios Técnicos', tipo: 'ingreso',   naturaleza: 'acreedora', nivel: 4, codigoPadre: '4101',    esMovimiento: true  },
  // COSTOS Y GASTOS
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

// ─── Insumos demo ─────────────────────────────────────────────────────────────

const INSUMOS_DEMO = [
  { codigo: 'CEM-01', nombre: 'Cemento Portland Tipo I',        descripcion: 'Saco 42.5 kg — uso general', unidad: 'SC', categoria: 'MATERIAL' },
  { codigo: 'VAR-3/8', nombre: 'Varilla corrugada 3/8"',        descripcion: 'Acero ASTM A615 Gr.60, 12m', unidad: 'KG', categoria: 'MATERIAL' },
  { codigo: 'VAR-1/2', nombre: 'Varilla corrugada 1/2"',        descripcion: 'Acero ASTM A615 Gr.60, 12m', unidad: 'KG', categoria: 'MATERIAL' },
  { codigo: 'BLK-6',   nombre: 'Block hueco 6x8x16"',           descripcion: 'Bloque de hormigón vibrado',  unidad: 'UN', categoria: 'MATERIAL' },
  { codigo: 'BLK-8',   nombre: 'Block hueco 8x8x16"',           descripcion: 'Bloque de hormigón vibrado',  unidad: 'UN', categoria: 'MATERIAL' },
  { codigo: 'ARE-LAV', nombre: 'Arena lavada',                   descripcion: 'Arena de río lavada, m³',     unidad: 'M3', categoria: 'MATERIAL' },
  { codigo: 'GRA-3/4', nombre: 'Grava 3/4"',                    descripcion: 'Piedra triturada 3/4"',       unidad: 'M3', categoria: 'MATERIAL' },
  { codigo: 'CAB-10',  nombre: 'Cable THHN #10 AWG',            descripcion: 'Cable eléctrico cobre 10 AWG', unidad: 'M', categoria: 'MATERIAL' },
  { codigo: 'TUB-4',   nombre: 'Tubería PVC 4" clase 125',      descripcion: 'Tubería PVC sanitaria 4"',    unidad: 'UN', categoria: 'MATERIAL' },
  { codigo: 'DIES',    nombre: 'Diesel',                         descripcion: 'Combustible para equipos',   unidad: 'GL', categoria: 'COMBUSTIBLE' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreate<T extends { id: string }>(
  find: () => Promise<T | undefined>,
  create: () => Promise<T>,
  label: string,
): Promise<T> {
  const existing = await find();
  if (existing) {
    console.log(`  · ${label} ya existe: ${existing.id}`);
    return existing;
  }
  const created = await create();
  console.log(`  ✓ ${label} creado: ${created.id}`);
  return created;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' Tributia BuildCore — Seed de Demo Completo            ');
  console.log('═══════════════════════════════════════════════════════\n');

  const now = new Date();

  // ── 1. Tenant ──────────────────────────────────────────────────────────────
  console.log('1. Tenant y Empresas');

  const tenant = await getOrCreate(
    async () => {
      const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, DEMO_SLUG));
      return t;
    },
    async () => {
      const [t] = await db.insert(schema.tenants).values({
        id: newId(), nombre: DEMO_TENANT_NOMBRE, slug: DEMO_SLUG,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      }).returning();
      return t!;
    },
    `Tenant "${DEMO_TENANT_NOMBRE}"`,
  );

  const tenantId = tenant.id;

  // ── 2. Empresas ────────────────────────────────────────────────────────────
  const empresaPrincipal = await getOrCreate(
    async () => {
      const [e] = await db.select().from(schema.empresas)
        .where(and(eq(schema.empresas.tenantId, tenantId), eq(schema.empresas.rnc, EMPRESA_PRINCIPAL.rnc)));
      return e;
    },
    async () => {
      const [e] = await db.insert(schema.empresas).values({
        id: newId(), tenantId, nombre: EMPRESA_PRINCIPAL.nombre, rnc: EMPRESA_PRINCIPAL.rnc,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      }).returning();
      return e!;
    },
    `Empresa principal "${EMPRESA_PRINCIPAL.nombre}"`,
  );

  const empresaSecundaria = await getOrCreate(
    async () => {
      const [e] = await db.select().from(schema.empresas)
        .where(and(eq(schema.empresas.tenantId, tenantId), eq(schema.empresas.rnc, EMPRESA_SECUNDARIA.rnc)));
      return e;
    },
    async () => {
      const [e] = await db.insert(schema.empresas).values({
        id: newId(), tenantId, nombre: EMPRESA_SECUNDARIA.nombre, rnc: EMPRESA_SECUNDARIA.rnc,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      }).returning();
      return e!;
    },
    `Empresa secundaria "${EMPRESA_SECUNDARIA.nombre}"`,
  );

  // Supresión de advertencia "empresaSecundaria used before definition"
  void empresaSecundaria;

  // ── 3. Catálogos DGII (globales — sin tenant_id) ───────────────────────────
  console.log('\n2. Catálogos DGII');

  let inserted = 0;
  for (const t of TIPOS_ECF) {
    const result = await db.insert(schema.tiposEcf).values({
      id: newId(), codigo: t.codigo, nombre: t.nombre, descripcion: t.descripcion, validoDesde: '2019-01-01',
    }).onConflictDoNothing();
    if ((result.rowCount ?? 0) > 0) inserted++;
  }
  console.log(`  ✓ ${TIPOS_ECF.length} tipos e-CF (${inserted} nuevos)`);

  inserted = 0;
  for (const t of TASAS_ITBIS) {
    const result = await db.insert(schema.tasasItbis).values({
      id: newId(), codigo: t.codigo, porcentaje: t.porcentaje, descripcion: t.descripcion, validoDesde: '2019-01-01',
    }).onConflictDoNothing();
    if ((result.rowCount ?? 0) > 0) inserted++;
  }
  console.log(`  ✓ ${TASAS_ITBIS.length} tasas ITBIS (${inserted} nuevas)`);

  inserted = 0;
  for (const t of TIPOS_RETENCION) {
    const result = await db.insert(schema.tiposRetencion).values({
      id: newId(), codigo: t.codigo, nombre: t.nombre, porcentaje: t.porcentaje,
      aplicaA: t.aplicaA, descripcion: t.descripcion, validoDesde: '2019-01-01',
    }).onConflictDoNothing();
    if ((result.rowCount ?? 0) > 0) inserted++;
  }
  console.log(`  ✓ ${TIPOS_RETENCION.length} tipos retención (${inserted} nuevos)`);

  // ── 4. Unidades de medida ──────────────────────────────────────────────────
  console.log('\n3. Unidades de medida');

  const unidadIds = new Map<string, string>();

  for (const u of UNIDADES_STD) {
    let [existing] = await db.select().from(schema.unidadesMedida)
      .where(and(eq(schema.unidadesMedida.tenantId, tenantId), eq(schema.unidadesMedida.codigo, u.codigo)));

    if (!existing) {
      const id = newId();
      [existing] = await db.insert(schema.unidadesMedida).values({
        id, tenantId, codigo: u.codigo, nombre: u.nombre, descripcion: u.descripcion,
        createdAt: now, createdBy: SYSTEM_USER_ID, updatedAt: now, updatedBy: SYSTEM_USER_ID,
      }).returning();
    }
    unidadIds.set(u.codigo, existing!.id);
  }
  console.log(`  ✓ ${UNIDADES_STD.length} unidades de medida`);

  // ── 5. Roles y permisos ────────────────────────────────────────────────────
  console.log('\n4. Roles y permisos');

  const rolIds: Record<string, string> = {};
  for (const perfil of PERFILES) {
    const [existing] = await db.select().from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.nombre, perfil.nombre)));

    let rolId: string;
    if (!existing) {
      const id = newId();
      await db.insert(schema.roles).values({
        id, tenantId, nombre: perfil.nombre, descripcion: perfil.descripcion,
        esSistema: true, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      });
      rolId = id;
      console.log(`  ✓ Rol creado: ${perfil.nombre}`);
    } else {
      rolId = existing.id;
      console.log(`  · Rol existe: ${perfil.nombre}`);
    }
    rolIds[perfil.nombre] = rolId;

    for (const permiso of perfil.permisos) {
      await db.insert(schema.rolPermisos).values({ rolId, permiso, tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID }).onConflictDoNothing();
    }
  }

  // ── 6. Usuarios ────────────────────────────────────────────────────────────
  console.log('\n5. Usuarios demo');

  for (const perfil of PERFILES) {
    const [existing] = await db.select().from(schema.usuarios)
      .where(and(eq(schema.usuarios.email, perfil.email), eq(schema.usuarios.tenantId, tenantId)));

    let userId: string;
    if (!existing) {
      const passwordHash = await argon2.hash(perfil.password, { type: argon2.argon2id });
      const id = newId();
      await db.insert(schema.usuarios).values({
        id, tenantId, email: perfil.email, passwordHash,
        nombre: perfil.nombreReal, apellido: perfil.apellido,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      });
      userId = id;
      console.log(`  ✓ Usuario creado: ${perfil.email}`);
    } else {
      userId = existing.id;
      console.log(`  · Usuario existe: ${perfil.email}`);
    }

    const rolId = rolIds[perfil.nombre];
    if (rolId) {
      await db.insert(schema.usuarioRolEmpresa).values({
        id: newId(), tenantId, usuarioId: userId, empresaId: empresaPrincipal.id, rolId,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      }).onConflictDoNothing();
    }
  }

  // ── 7. Plan de cuentas RD (empresa principal) ──────────────────────────────
  console.log('\n6. Plan de cuentas RD');

  const codigoAId = new Map<string, string>();
  let cuentasNuevas = 0;

  for (const cuenta of PLAN_RD) {
    const [existing] = await db.select({ id: schema.cuentasContables.id })
      .from(schema.cuentasContables)
      .where(and(
        eq(schema.cuentasContables.empresaId, empresaPrincipal.id),
        eq(schema.cuentasContables.codigo, cuenta.codigo),
      ))
      .limit(1);

    let cuentaId: string;
    if (!existing) {
      cuentaId = newId();
      const padreId = cuenta.codigoPadre ? (codigoAId.get(cuenta.codigoPadre) ?? null) : null;
      await db.insert(schema.cuentasContables).values({
        id: cuentaId, tenantId, empresaId: empresaPrincipal.id,
        codigo: cuenta.codigo, nombre: cuenta.nombre,
        tipo: cuenta.tipo, naturaleza: cuenta.naturaleza,
        nivel: cuenta.nivel, padreId, esMovimiento: cuenta.esMovimiento,
        activo: true, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      }).onConflictDoNothing();
      cuentasNuevas++;
    } else {
      cuentaId = existing.id;
    }
    codigoAId.set(cuenta.codigo, cuentaId);
  }
  console.log(`  ✓ ${PLAN_RD.length} cuentas procesadas (${cuentasNuevas} nuevas)`);

  // ── 8. Regla contable: consumo_material ───────────────────────────────────
  console.log('\n7. Regla contable');

  const configuracionRegla: ConfiguracionRegla = {
    lineas: [
      { tipo: 'debito',  cuentaCodigo: '5101',    descripcion: 'Costo de obra en proceso — consumo de materiales' },
      { tipo: 'credito', cuentaCodigo: '1104.01', descripcion: 'Salida de inventario de materiales' },
    ],
  };

  const [reglaExistente] = await db.select({ id: schema.reglasContables.id })
    .from(schema.reglasContables)
    .where(and(
      eq(schema.reglasContables.empresaId, empresaPrincipal.id),
      eq(schema.reglasContables.tipoEvento, 'consumo_material'),
      eq(schema.reglasContables.activo, true),
    ))
    .limit(1);

  let reglaId: string;
  if (!reglaExistente) {
    reglaId = newId();
    await db.insert(schema.reglasContables).values({
      id: reglaId, tenantId, empresaId: empresaPrincipal.id,
      tipoEvento: 'consumo_material',
      nombre: 'Consumo de Material → Costo Obra en Proceso',
      descripcion: 'Registra la salida de inventario como costo de obra en proceso.',
      configuracion: configuracionRegla,
      prioridad: 0, activo: true,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    console.log(`  ✓ Regla contable creada: ${reglaId}`);
  } else {
    reglaId = reglaExistente.id;
    console.log(`  · Regla contable ya existe: ${reglaId}`);
  }

  // ── 8b. Regla contable: emision_factura_cliente ────────────────────────────
  const configuracionFacturaCliente: ConfiguracionRegla = {
    lineas: [
      { tipo: 'debito',  cuentaCodigo: '1102.01', descripcion: 'CxC — neto a cobrar del cliente', montoKey: 'netoACobrar' },
      { tipo: 'debito',  cuentaCodigo: '1105.01', descripcion: 'ISR retenido por el cliente (Estado)', montoKey: 'retencionIsr' },
      { tipo: 'debito',  cuentaCodigo: '1105.02', descripcion: 'ITBIS retenido por el cliente (Estado)', montoKey: 'retencionItbis' },
      { tipo: 'credito', cuentaCodigo: '4101.01', descripcion: 'Ingreso por avance de obra certificado', montoKey: 'subtotal' },
      { tipo: 'credito', cuentaCodigo: '2103.01', descripcion: 'ITBIS cobrado a clientes', montoKey: 'itbis' },
    ],
  };

  const [reglaFacturaClienteExistente] = await db.select({ id: schema.reglasContables.id })
    .from(schema.reglasContables)
    .where(and(
      eq(schema.reglasContables.empresaId, empresaPrincipal.id),
      eq(schema.reglasContables.tipoEvento, 'emision_factura_cliente'),
      eq(schema.reglasContables.activo, true),
    ))
    .limit(1);

  if (!reglaFacturaClienteExistente) {
    const reglaFacturaClienteId = newId();
    await db.insert(schema.reglasContables).values({
      id: reglaFacturaClienteId, tenantId, empresaId: empresaPrincipal.id,
      tipoEvento: 'emision_factura_cliente',
      nombre: 'Emisión Factura Cliente → Ingreso + CxC + Retenciones',
      descripcion: 'Registra el ingreso por avance certificado, la CxC neta y las retenciones del cliente.',
      configuracion: configuracionFacturaCliente,
      prioridad: 0, activo: true,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    console.log(`  ✓ Regla contable emision_factura_cliente creada: ${reglaFacturaClienteId}`);
  } else {
    console.log(`  · Regla contable emision_factura_cliente ya existe: ${reglaFacturaClienteExistente.id}`);
  }

  // ── 9. Insumos demo ────────────────────────────────────────────────────────
  console.log('\n8. Catálogo de insumos');

  const insumoIds = new Map<string, string>();
  let insumosNuevos = 0;

  for (const ins of INSUMOS_DEMO) {
    const unidadId = unidadIds.get(ins.unidad);
    if (!unidadId) {
      console.warn(`  ⚠ Unidad '${ins.unidad}' no encontrada, saltando ${ins.codigo}`);
      continue;
    }

    const [existing] = await db.select({ id: schema.insumos.id })
      .from(schema.insumos)
      .where(and(eq(schema.insumos.tenantId, tenantId), eq(schema.insumos.codigo, ins.codigo)))
      .limit(1);

    let insumoId: string;
    if (!existing) {
      insumoId = newId();
      await db.insert(schema.insumos).values({
        id: insumoId, tenantId, codigo: ins.codigo, nombre: ins.nombre,
        descripcion: ins.descripcion ?? null, unidadId,
        categoria: ins.categoria as 'MATERIAL' | 'COMBUSTIBLE',
        createdAt: now, createdBy: SYSTEM_USER_ID, updatedAt: now, updatedBy: SYSTEM_USER_ID,
      });
      insumosNuevos++;
    } else {
      insumoId = existing.id;
    }
    insumoIds.set(ins.codigo, insumoId);
  }
  console.log(`  ✓ ${INSUMOS_DEMO.length} insumos procesados (${insumosNuevos} nuevos)`);

  // ── 9b. Terceros demo (clientes y proveedores) ─────────────────────────────
  console.log('\n9b. Terceros demo (clientes + proveedores)');

  const TERCEROS_DEMO = [
    {
      rncCedula: '130123456',
      nombreComercial: 'Ministerio de Obras Públicas (MOPC)',
      nombreLegal: 'Ministerio de Obras Públicas y Comunicaciones',
      tipoIdentificacion: 'RNC' as const,
      tipoContribuyente: 'PERSONA_JURIDICA' as const,
      condicionDgii: 'NORMAL' as const,
      esCliente: true, esProveedor: false, esSubcontratista: false,
      esEmpleadoRelacionado: false, esBanco: false, esInstitucionEstatal: true,
    },
    {
      rncCedula: '101234567',
      nombreComercial: 'Inmobiliaria Palma Real S.A.',
      nombreLegal: 'Inmobiliaria Palma Real S.A.',
      tipoIdentificacion: 'RNC' as const,
      tipoContribuyente: 'PERSONA_JURIDICA' as const,
      condicionDgii: 'NORMAL' as const,
      esCliente: true, esProveedor: false, esSubcontratista: false,
      esEmpleadoRelacionado: false, esBanco: false, esInstitucionEstatal: false,
    },
    {
      rncCedula: '105678901',
      nombreComercial: 'Ferretería Nacional S.R.L.',
      nombreLegal: 'Ferretería Nacional S.R.L.',
      tipoIdentificacion: 'RNC' as const,
      tipoContribuyente: 'PERSONA_JURIDICA' as const,
      condicionDgii: 'NORMAL' as const,
      esCliente: false, esProveedor: true, esSubcontratista: false,
      esEmpleadoRelacionado: false, esBanco: false, esInstitucionEstatal: false,
    },
    {
      rncCedula: '107890123',
      nombreComercial: 'Cemex Dominicana S.A.',
      nombreLegal: 'Cemex Dominicana S.A.',
      tipoIdentificacion: 'RNC' as const,
      tipoContribuyente: 'PERSONA_JURIDICA' as const,
      condicionDgii: 'NORMAL' as const,
      esCliente: false, esProveedor: true, esSubcontratista: false,
      esEmpleadoRelacionado: false, esBanco: false, esInstitucionEstatal: false,
    },
  ];

  for (const t of TERCEROS_DEMO) {
    const [existing] = await db.select({ id: schema.terceros.id })
      .from(schema.terceros)
      .where(and(
        eq(schema.terceros.tenantId, tenantId),
        eq(schema.terceros.rncCedula, t.rncCedula),
      ))
      .limit(1);

    if (!existing) {
      await db.insert(schema.terceros).values({
        id: newId(), tenantId,
        tipoIdentificacion: t.tipoIdentificacion,
        rncCedula: t.rncCedula,
        nombreComercial: t.nombreComercial,
        nombreLegal: t.nombreLegal,
        tipoContribuyente: t.tipoContribuyente,
        condicionDgii: t.condicionDgii,
        esCliente: t.esCliente,
        esProveedor: t.esProveedor,
        esSubcontratista: t.esSubcontratista,
        esEmpleadoRelacionado: t.esEmpleadoRelacionado,
        esBanco: t.esBanco,
        esInstitucionEstatal: t.esInstitucionEstatal,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      });
      console.log(`  ✓ Tercero "${t.nombreComercial}" creado`);
    } else {
      console.log(`  · Tercero "${t.nombreComercial}" ya existe`);
    }
  }

  // ── 10. Centro de costo + Evento + Asiento (flujo canónico §5) ─────────────
  console.log('\n10. Flujo canónico: centro de costo → consumo_material → asiento');

  // Centro de costo demo (para la imputación del evento)
  const CC_CODIGO = 'CC-OBRA-001';
  const centroCosto = await getOrCreate(
    async () => {
      const [cc] = await db.select().from(schema.centrosCosto)
        .where(and(
          eq(schema.centrosCosto.tenantId, tenantId),
          eq(schema.centrosCosto.empresaId, empresaPrincipal.id),
          eq(schema.centrosCosto.codigo, CC_CODIGO),
        ));
      return cc;
    },
    async () => {
      const [cc] = await db.insert(schema.centrosCosto).values({
        id: newId(), tenantId, empresaId: empresaPrincipal.id,
        codigo: CC_CODIGO,
        nombre: 'Obra Residencial La Esperanza',
        tipo: 'PROYECTO',
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      }).returning();
      return cc!;
    },
    `Centro de costo "${CC_CODIGO}"`,
  );

  // Evento consumo_material (idempotente: UNIQUE idempotency_key)
  const IDEMPOTENCY_KEY = 'demo-consumo-cemento-50sc-2026';
  const [eventoExistente] = await db.select({ id: schema.eventosOperativos.id })
    .from(schema.eventosOperativos)
    .where(eq(schema.eventosOperativos.idempotencyKey, IDEMPOTENCY_KEY))
    .limit(1);

  let eventoId: string;
  const insumosCementoId = insumoIds.get('CEM-01') ?? newId();
  // almacenId no tiene tabla aún — usamos un UUID fijo de demo
  const ALMACEN_DEMO_ID = '00000000-0000-7001-0000-000000000001';

  if (!eventoExistente) {
    eventoId = newId();
    const adminUserId = (await db.select({ id: schema.usuarios.id })
      .from(schema.usuarios)
      .where(and(eq(schema.usuarios.tenantId, tenantId), eq(schema.usuarios.email, 'almacenista@demo-rd.com')))
      .limit(1))[0]?.id ?? SYSTEM_USER_ID;

    await db.insert(schema.eventosOperativos).values({
      id: eventoId,
      tenantId,
      empresaId: empresaPrincipal.id,
      centroCostoId: centroCosto.id,
      tipoEvento: 'consumo_material',
      ocurridoEn: new Date('2026-06-01T10:00:00Z'),
      usuarioId: adminUserId,
      payload: {
        insumoId: insumosCementoId,
        almacenId: ALMACEN_DEMO_ID,
        cantidad: '50.0000',
        unidad: 'SC',
        costoUnitario: { monto: '430.0000', moneda: 'DOP' },
        partidaId: null,
      },
      idempotencyKey: IDEMPOTENCY_KEY,
      estado: 'registrado',
      createdBy: adminUserId,
    });
    console.log(`  ✓ Evento consumo_material creado: ${eventoId}`);
  } else {
    eventoId = eventoExistente.id;
    console.log(`  · Evento consumo_material ya existe: ${eventoId}`);
  }

  // Asiento contable para el evento (idempotente vía UNIQUE evento_id + regla_id)
  const [asientoExistente] = await db.select({ id: schema.asientosContables.id })
    .from(schema.asientosContables)
    .where(and(
      eq(schema.asientosContables.eventoId, eventoId),
      eq(schema.asientosContables.reglaId, reglaId),
    ))
    .limit(1);

  if (!asientoExistente) {
    const asientoId = newId();
    const fecha = '2026-06-01';
    const descripcion = 'Consumo 50 SC Cemento Portland I — Obra Residencial La Esperanza';

    // Monto: 50 SC × RD$ 430 = RD$ 21,500
    const importe = '21500.0000';

    const cuenta5101Id = codigoAId.get('5101');
    const cuenta1104Id = codigoAId.get('1104.01');

    if (!cuenta5101Id || !cuenta1104Id) {
      console.warn('  ⚠ Cuentas 5101 o 1104.01 no encontradas — asiento omitido');
    } else {
      await db.insert(schema.asientosContables).values({
        id: asientoId, tenantId, empresaId: empresaPrincipal.id,
        numero: `AST-2026-${asientoId.slice(0, 8).toUpperCase()}`,
        tipo: 'automatico',
        eventoId,
        reglaId,
        fecha,
        descripcion,
        estado: 'confirmado',
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      });

      await db.insert(schema.lineasAsiento).values([
        {
          id: newId(), tenantId, asientoId,
          cuentaId: cuenta5101Id,
          tipo: 'debe',
          importe,
          moneda: 'DOP',
          descripcion: 'Costo de obra — consumo cemento',
        },
        {
          id: newId(), tenantId, asientoId,
          cuentaId: cuenta1104Id,
          tipo: 'haber',
          importe,
          moneda: 'DOP',
          descripcion: 'Salida inventario materiales',
        },
      ]);

      console.log(`  ✓ Asiento contable creado: ${asientoId}`);
      console.log(`    DB 5101 Costo de Obra en Proceso  RD$ ${importe}`);
      console.log(`    CR 1104.01 Inventario Materiales  RD$ ${importe}`);
    }
  } else {
    console.log(`  · Asiento contable ya existe: ${asientoExistente.id}`);
  }

  // ─── Resumen ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' Seed completado correctamente                          ');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('Credenciales de acceso:');
  console.log(`  Tenant slug: ${DEMO_SLUG}`);
  for (const p of PERFILES) {
    console.log(`  ${p.nombre.padEnd(20)} ${p.email}  /  ${p.password}`);
  }

  await pool.end();
}

main().catch((err: unknown) => {
  console.error('Error en seed:', err);
  process.exit(1);
});
