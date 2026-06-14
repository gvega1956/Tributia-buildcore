/**
 * Tipos para los catálogos DGII versionados.
 * Los datos son system-level (sin tenant_id) — iguales para todos los tenants.
 * La DGII puede cambiar estos valores; se versiona por valido_desde/valido_hasta.
 */

/** Tipos de e-CF habilitados por la DGII. */
export type CodigoEcf =
  | '31' // Factura de Crédito Fiscal
  | '32' // Factura de Consumidor Final
  | '33' // Nota de Débito
  | '34' // Nota de Crédito
  | '41' // Compras
  | '43' // Gastos Menores (Régimen Especial)
  | '44' // Regímenes Especiales de Tributación
  | '45' // Gubernamentales
  | '46' // Exportaciones
  | '47'; // Pagos al Exterior

export interface TipoEcfRecord {
  id: string;
  codigo: CodigoEcf;
  nombre: string;
  descripcion: string;
  validoDesde: string;
  validoHasta: string | null;
  activo: boolean;
}

export interface TasaItbisRecord {
  id: string;
  codigo: string;
  porcentaje: string;
  descripcion: string;
  validoDesde: string;
  validoHasta: string | null;
}

export interface TipoRetencionRecord {
  id: string;
  codigo: string;
  nombre: string;
  porcentaje: string;
  aplicaA: 'SERVICIOS' | 'BIENES' | 'AMBOS';
  descripcion: string;
  validoDesde: string;
  validoHasta: string | null;
}
