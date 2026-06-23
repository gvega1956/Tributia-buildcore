import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api';
import type {
  OrdenCambioCreateInput,
  LineaOrdenCambioAddInput,
  OrdenCambioAprobarInput,
  OrdenCambioRechazarInput,
  EstadoOrdenCambio,
  CausaOrdenCambio,
  TipoImpacto,
} from '@tributia/ordenes-cambio';

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export type LineaOrdenCambio = {
  id: string;
  ordenCambioId: string;
  partidaId: string | null;
  descripcion: string;
  esPartidaNueva: boolean;
  cantidadAdicional: string | null;
  montoAdicional: string;
  tipoImpacto: TipoImpacto;
};

export type OrdenCambio = {
  id: string;
  empresaId: string;
  proyectoId: string;
  causa: CausaOrdenCambio;
  descripcion: string;
  estado: EstadoOrdenCambio;
  diasAdicionalesSolicitados: number | null;
  diasAdicionalesAprobados: number | null;
  montoAprobado: string | null;
  razonRechazo: string | null;
  createdAt: string;
  lineas: LineaOrdenCambio[];
  /** Alerta Regla de Oro — trabajo ejecutado fuera de presupuesto */
  alertaReglaOro?: string | null;
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function apiErr(error: unknown): Error {
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: string };
    if (e.message) return new Error(e.message);
  }
  return new Error('Error en la API');
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useOrdenesCambio(proyectoId?: string) {
  return useQuery({
    queryKey: ['ordenes-cambio', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/ordenes-cambio', {
        params: { query: proyectoId ? { proyectoId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as OrdenCambio[]) ?? [];
    },
  });
}

export function useOrdenCambio(id: string) {
  return useQuery({
    queryKey: ['ordenes-cambio', id],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/ordenes-cambio/{id}', {
        params: { path: { id } },
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCambio;
    },
    enabled: !!id,
  });
}

export function useHistorialOC(proyectoId: string) {
  return useQuery({
    queryKey: ['ordenes-cambio-historial', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET(
        '/api/v1/ordenes-cambio/proyecto/{proyectoId}/historial',
        { params: { path: { proyectoId } } },
      );
      if (error) throw apiErr(error);
      return (data as unknown as OrdenCambio[]) ?? [];
    },
    enabled: !!proyectoId,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateOrdenCambio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OrdenCambioCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/ordenes-cambio', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCambio;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ordenes-cambio'] }); },
  });
}

export function useAddLineaOC(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LineaOrdenCambioAddInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/ordenes-cambio/{id}/lineas', {
        params: { path: { id } },
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCambio;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ordenes-cambio'] });
      qc.invalidateQueries({ queryKey: ['ordenes-cambio', id] });
    },
  });
}

export function useEnviarOCAlCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/ordenes-cambio/{id}/enviar-al-cliente', {
        params: { path: { id } },
        body: {} as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCambio;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ordenes-cambio'] }); },
  });
}

export function useAprobarOC() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: OrdenCambioAprobarInput }) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/ordenes-cambio/{id}/aprobar', {
        params: { path: { id } },
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCambio;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ordenes-cambio'] }); },
  });
}

export function useRechazarOC() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: OrdenCambioRechazarInput }) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/ordenes-cambio/{id}/rechazar', {
        params: { path: { id } },
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCambio;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ordenes-cambio'] }); },
  });
}

export function useAnularOC() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/ordenes-cambio/{id}/anular', {
        params: { path: { id } },
        body: {} as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCambio;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ordenes-cambio'] }); },
  });
}

export type { EstadoOrdenCambio, CausaOrdenCambio };
