import { useQuery } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api';

// ─── Tipos de respuesta (espejo de tablero.service.ts) ───────────────────────

export type AlertaTablero = 'VERDE' | 'AMARILLO' | 'ROJO';

export interface TableroPartidaRow {
  partidaId: string;
  codigo: string;
  nombre: string;
  nivel: number;
  numeroJerarquico: string;
  presupuestoVigente: string;
  comprometido: string;
  devengado: string;
  pagado: string;
  disponible: string;
  avancePct: string;
  ev: string;
  ac: string;
  cpi: string | null;
  spi: string | null;
  alerta: AlertaTablero;
}

export interface TableroProyecto {
  proyectoId: string;
  presupuestoVigente: string;
  comprometido: string;
  devengado: string;
  pagado: string;
  disponible: string;
  avancePct: string;
  ev: string;
  ac: string;
  cpi: string | null;
  spi: string | null;
  alerta: AlertaTablero;
  partidas: TableroPartidaRow[];
}

export interface CurvaSPoint {
  semana: string;
  evAcumulado: string;
  acAcumulado: string;
}

export interface TrazabilidadRow {
  eventoId: string;
  tipoEvento: string;
  ocurridoEn: string;
  referenciaTabla: string | null;
  referenciaId: string | null;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function apiErr(error: unknown): Error {
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: string };
    if (e.message) return new Error(e.message);
  }
  return new Error('Error en la API');
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useTablero(proyectoId: string) {
  return useQuery({
    queryKey: ['tablero', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/tablero/proyecto/{id}', {
        params: { path: { id: proyectoId } },
      });
      if (error) throw apiErr(error);
      return data as unknown as TableroProyecto;
    },
    enabled: !!proyectoId,
    staleTime: 30_000,
  });
}

export function useCurvaS(proyectoId: string) {
  return useQuery({
    queryKey: ['curva-s', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/tablero/proyecto/{id}/curva-s', {
        params: { path: { id: proyectoId } },
      });
      if (error) throw apiErr(error);
      return (data as unknown as CurvaSPoint[]) ?? [];
    },
    enabled: !!proyectoId,
    staleTime: 30_000,
  });
}

export function useTrazabilidad(partidaId: string | null) {
  return useQuery({
    queryKey: ['trazabilidad', partidaId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/tablero/partida/{id}/trazabilidad', {
        params: { path: { id: partidaId! } },
      });
      if (error) throw apiErr(error);
      return (data as unknown as TrazabilidadRow[]) ?? [];
    },
    enabled: !!partidaId,
  });
}
