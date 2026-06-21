import type { EstadoProyecto } from '@tributia/proyectos';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export const ESTADO_LABELS: Record<EstadoProyecto, string> = {
  PROSPECTO:    'Prospecto',
  LICITACION:   'Licitación',
  ADJUDICADO:   'Adjudicado',
  EN_EJECUCION: 'En ejecución',
  CIERRE:       'Cierre',
  GARANTIA:     'Garantía',
  CERRADO:      'Cerrado',
};

export const ESTADO_BADGE: Record<EstadoProyecto, BadgeVariant> = {
  PROSPECTO:    'default',
  LICITACION:   'info',
  ADJUDICADO:   'info',
  EN_EJECUCION: 'success',
  CIERRE:       'warning',
  GARANTIA:     'warning',
  CERRADO:      'default',
};

export function formatMoney(monto: string | null | undefined, moneda = 'DOP'): string {
  if (!monto) return '—';
  try {
    const num = parseFloat(monto);
    if (isNaN(num)) return monto;
    return new Intl.NumberFormat('es-DO', {
      style: 'currency',
      currency: moneda,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return monto;
  }
}

export function formatFecha(fecha: string | null | undefined): string {
  if (!fecha) return '—';
  return new Date(fecha + 'T00:00:00').toLocaleDateString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
