import { z } from 'zod';

// ─── Categorías de documentos ─────────────────────────────────────────────────

export const CATEGORIAS_ARCHIVO = [
  'CONTRATO',
  'POLIZA',
  'FIANZA',
  'PLANO',
  'FOTO',
  'FACTURA',
  'CERTIFICACION',
  'OTRO',
] as const;

export type CategoriaArchivo = (typeof CATEGORIAS_ARCHIVO)[number];

// ─── Tipos de notificación ────────────────────────────────────────────────────

export const TIPOS_NOTIFICACION = [
  'VENCIMIENTO_DOCUMENTO',
  'FLUJO_APROBACION',
  'SISTEMA',
] as const;

export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];

export const CANALES_NOTIFICACION = ['IN_APP', 'EMAIL', 'WHATSAPP'] as const;

export type CanalNotificacion = (typeof CANALES_NOTIFICACION)[number];

// ─── Schemas de entrada: Documental ──────────────────────────────────────────

export const zSubirArchivo = z.object({
  nombre: z.string().min(1).max(500),
  descripcion: z.string().max(2000).nullable().default(null),
  entidadTipo: z.string().min(1).max(100),
  entidadId: z.string().uuid(),
  categoria: z.enum(CATEGORIAS_ARCHIVO).default('OTRO'),
  fechaVencimiento: z.string().date().nullable().default(null),
  alertaDiasAntes: z.number().int().min(1).max(365).nullable().default(null),
  notaVersion: z.string().max(500).nullable().default(null),
});

export const zSubirNuevaVersion = z.object({
  notaVersion: z.string().max(500).nullable().default(null),
});

export const zListarArchivos = z.object({
  entidadTipo: z.string().min(1).max(100).optional(),
  entidadId: z.string().uuid().optional(),
  categoria: z.enum(CATEGORIAS_ARCHIVO).optional(),
});

export const zProximosVencimientos = z.object({
  diasHasta: z.number().int().min(1).max(365).default(30),
});

// ─── Schemas de entrada: Notificaciones ──────────────────────────────────────

export const zCrearNotificacion = z.object({
  usuarioId: z.string().uuid(),
  tipo: z.enum(TIPOS_NOTIFICACION),
  canal: z.enum(CANALES_NOTIFICACION).default('IN_APP'),
  asunto: z.string().min(1).max(500),
  cuerpo: z.string().min(1),
  referenciaTipo: z.string().max(100).nullable().default(null),
  referenciaId: z.string().uuid().nullable().default(null),
});

// ─── Tipos inferidos ──────────────────────────────────────────────────────────

export type SubirArchivoInput = z.infer<typeof zSubirArchivo>;
export type SubirNuevaVersionInput = z.infer<typeof zSubirNuevaVersion>;
export type ListarArchivosInput = z.infer<typeof zListarArchivos>;
export type ProximosVencimientosInput = z.infer<typeof zProximosVencimientos>;
export type CrearNotificacionInput = z.infer<typeof zCrearNotificacion>;
