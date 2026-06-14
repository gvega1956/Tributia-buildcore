import { z } from 'zod';

export type TipoIdentificacion = 'RNC' | 'CEDULA' | 'PASAPORTE' | 'EXTRANJERO';
export type TipoContribuyente = 'PERSONA_FISICA' | 'PERSONA_JURIDICA' | 'ENTIDAD_GUBERNAMENTAL';
export type CondicionDgii = 'NORMAL' | 'GRAN_CONTRIBUYENTE' | 'REGIMEN_SIMPLIFICADO';

/**
 * RNC (9 dígitos) o Cédula (11 dígitos), con o sin guiones.
 * Se normaliza a solo dígitos antes de validar.
 * RNC ejemplo: 101-00001-1 → "101000011" (9 dígitos)
 * Cédula ejemplo: 001-1234567-8 → "00112345678" (11 dígitos)
 */
export const zRncCedula = z
  .string()
  .transform((v) => v.replace(/-/g, ''))
  .pipe(z.string().regex(/^\d{9}$|^\d{11}$/, 'Debe tener 9 dígitos (RNC) u 11 dígitos (Cédula)'));

/** Inferencia del tipo a partir del número de dígitos. */
export function inferirTipoIdentificacion(
  rncCedula: string,
): 'RNC' | 'CEDULA' {
  const digitos = rncCedula.replace(/-/g, '');
  return digitos.length === 9 ? 'RNC' : 'CEDULA';
}

const zTerceroBase = z.object({
  tipoIdentificacion: z.enum(['RNC', 'CEDULA', 'PASAPORTE', 'EXTRANJERO']),
  rncCedula: zRncCedula,
  nombreComercial: z.string().min(1).max(200),
  nombreLegal: z.string().min(1).max(200).optional(),
  tipoContribuyente: z.enum(['PERSONA_FISICA', 'PERSONA_JURIDICA', 'ENTIDAD_GUBERNAMENTAL']),
  condicionDgii: z.enum(['NORMAL', 'GRAN_CONTRIBUYENTE', 'REGIMEN_SIMPLIFICADO']).default('NORMAL'),
  // Roles (al menos uno debe estar activo)
  esCliente: z.boolean().default(false),
  esProveedor: z.boolean().default(false),
  esSubcontratista: z.boolean().default(false),
  esEmpleadoRelacionado: z.boolean().default(false),
  esBanco: z.boolean().default(false),
  esInstitucionEstatal: z.boolean().default(false),
  // Retenciones (override por tercero; null = usa las tasas DGII por defecto)
  retencionIsrPct: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().default(null),
  retencionItbisPct: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().default(null),
  // Contacto
  email: z.string().email().nullable().default(null),
  telefono: z.string().max(20).nullable().default(null),
  direccion: z.string().max(500).nullable().default(null),
});

export const zTerceroCreate = zTerceroBase.refine(
  (d) =>
    d.esCliente ||
    d.esProveedor ||
    d.esSubcontratista ||
    d.esEmpleadoRelacionado ||
    d.esBanco ||
    d.esInstitucionEstatal,
  { message: 'Debe activarse al menos un rol para el tercero', path: ['esCliente'] },
);

export const zTerceroUpdate = zTerceroBase.partial().omit({ rncCedula: true });

export type TerceroCreateInput = z.infer<typeof zTerceroCreate>;
export type TerceroUpdateInput = z.infer<typeof zTerceroUpdate>;
