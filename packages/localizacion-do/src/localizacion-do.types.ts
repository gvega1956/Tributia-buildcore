/**
 * Tipos del módulo de localización República Dominicana.
 *
 * SCOPE: Solo validación de e-CF recibidos de proveedores (Capa 1).
 * La emisión de e-CF propios es Capa 2 (requiere integración con middleware DGII).
 */

/** Tipos de NCF/e-CF válidos según DGII */
export const TIPOS_NCF = {
  // Comprobantes tradicionales (B)
  B01: 'Crédito Fiscal',
  B02: 'Consumidor Final',
  B03: 'Nota de Débito',
  B04: 'Nota de Crédito',
  B11: 'Compras',
  B12: 'Gastos Menores',
  B13: 'Regímenes Especiales de Tributación',
  B14: 'Gubernamentales',
  B15: 'Comprobantes de Exportación',
  B16: 'Comprobante para Pagos al Exterior',
  // Comprobantes fiscales electrónicos (e-CF)
  E31: 'e-CF de Crédito Fiscal',
  E32: 'e-CF de Consumidor Final',
  E33: 'e-CF de Nota de Débito',
  E34: 'e-CF de Nota de Crédito',
  E41: 'e-CF de Compras',
  E43: 'e-CF de Regímenes Especiales',
  E44: 'e-CF Gubernamentales',
  E45: 'e-CF de Exportación',
  E46: 'e-CF para Pagos al Exterior',
} as const;

export type TipoNcf = keyof typeof TIPOS_NCF;

/** Resultado de la validación de un e-CF/NCF */
export interface EcfValidationResult {
  valido: boolean;
  errores: string[];
  advertencias: string[];
  tipoDetectado?: TipoNcf | undefined;
  descripcionTipo?: string | undefined;
}

/** Entrada para la validación de un e-CF/NCF */
export interface EcfValidationInput {
  /** NCF o e-CF del proveedor, tal como aparece en la factura */
  ncf: string;
  /** RNC o Cédula del proveedor */
  rncProveedor: string;
  /** Tipo esperado (validación opcional) */
  tipoEsperado?: TipoNcf;
  /** Fecha de emisión del comprobante (para validar vigencia) */
  fechaEmision?: Date;
}
