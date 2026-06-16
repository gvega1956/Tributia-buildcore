export type TipoLineaRegla = 'debito' | 'credito';

export interface LineaReglaConfig {
  tipo: TipoLineaRegla;
  cuentaCodigo: string;
  descripcion: string;
  // Clave opcional para buscar el monto de esta línea en un mapa de montos
  // construido por el handler (Record<montoKey, Money>) cuando el evento
  // produce varios importes distintos (ej. subtotal/itbis/retenciones).
  // Si se omite, el handler aplica el monto uniforme por defecto.
  montoKey?: string;
}

/**
 * Configuración JSON almacenada en regla_contable.configuracion.
 *
 * Cada línea especifica:
 *  - tipo: 'debito' o 'credito'
 *  - cuentaCodigo: código del plan de cuentas del tenant (e.g. "5101", "1104.01")
 *  - descripcion: texto que aparecerá en la línea del asiento
 *  - montoKey: opcional, ver arriba
 *
 * El importe de cada línea se calcula por el handler correspondiente
 * a partir del payload del evento — la regla solo define QUENTAS, no montos.
 */
export interface ConfiguracionRegla {
  lineas: LineaReglaConfig[];
}
