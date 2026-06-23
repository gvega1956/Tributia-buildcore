import { useQuery } from '@tanstack/react-query';

export type AlertaCartera = 'VERDE' | 'AMARILLO' | 'ROJO';

export interface KPIsCartera {
  totalProyectosActivos: number;
  montoTotalCartera: string;
  monedaBase: string;
  cpiPromedioPonderado: string | null;
  spiPromedioPonderado: string | null;
  proyectosEnRojo: number;
  proyectosEnAmarillo: number;
  proyectosEnVerde: number;
}

export interface SaludProyecto {
  proyectoId: string;
  codigo: string;
  nombre: string;
  alerta: AlertaCartera;
  cpi: string | null;
  spi: string | null;
  avancePct: string;
  presupuestoVigente: string;
  monedaContrato: string;
}

export interface ActividadItem {
  eventoId: string;
  tipoEvento: string;
  proyectoNombre: string;
  ocurridoEn: string;
}

// apiFetch es independiente del cliente OpenAPI para endpoints de agregación
// que aún no están en la spec generada. Usa el mismo token que getApiClient.
async function apiFetch<T>(path: string): Promise<T> {
  const baseUrl = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3000';
  const token = localStorage.getItem('tributia_access_token');
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${path}`);
  return res.json() as Promise<T>;
}

export function useKPIsCartera() {
  return useQuery({
    queryKey: ['dashboard-ejecutivo', 'kpis'],
    queryFn: () => apiFetch<KPIsCartera>('/api/v1/tablero/cartera/kpis'),
    staleTime: 60_000,
  });
}

export function useSaludProyectos() {
  return useQuery({
    queryKey: ['dashboard-ejecutivo', 'salud'],
    queryFn: () => apiFetch<SaludProyecto[]>('/api/v1/tablero/cartera/salud'),
    staleTime: 60_000,
  });
}

export function useFeedActividad() {
  return useQuery({
    queryKey: ['dashboard-ejecutivo', 'actividad'],
    queryFn: () => apiFetch<ActividadItem[]>('/api/v1/tablero/cartera/actividad'),
    staleTime: 30_000,
  });
}
