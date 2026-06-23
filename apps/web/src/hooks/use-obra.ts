import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api';
import type {
  ParteDiarioCreateInput,
  RfiCreateInput,
  RfiResponderInput,
  PunchListCreateInput,
  PunchListActualizarEstadoInput,
} from '@tributia/obra';

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export type EstadoRfi = 'ABIERTA' | 'RESPONDIDA' | 'CERRADA';
export type EstadoPunchItem = 'PENDIENTE' | 'EN_PROGRESO' | 'COMPLETADO' | 'RECHAZADO';

export type AvanceItem = {
  id: string;
  partidaId: string;
  cantidadEjecutada: string;
  unidad: string;
  observaciones: string | null;
};

export type PersonalItem = {
  id: string;
  nombre: string;
  tipo: 'PROPIO' | 'SUBCONTRATADO';
  horasTrabajadas: string;
  partidaId: string;
  tarifaHoraria: string;
  moneda: string;
};

export type EquipoItem = {
  id: string;
  equipoId: string;
  horasOperadas: string;
  partidaId: string;
  observaciones: string | null;
};

export type ParteDiario = {
  id: string;
  proyectoId: string;
  empresaId: string;
  fecha: string;
  clima: string | null;
  temperaturaC: string | null;
  notas: string | null;
  confirmado: boolean;
  createdAt: string;
  personal: PersonalItem[];
  equipos: EquipoItem[];
  avances: AvanceItem[];
};

export type Rfi = {
  id: string;
  proyectoId: string;
  titulo: string;
  descripcion: string;
  estado: EstadoRfi;
  impacto: string;
  impactoDias: number | null;
  impactoMonto: string | null;
  asignadoA: string | null;
  fechaLimite: string | null;
  respuesta: string | null;
  createdAt: string;
};

export type PunchItem = {
  id: string;
  proyectoId: string;
  descripcion: string;
  ubicacion: string | null;
  responsableId: string | null;
  fechaLimite: string | null;
  estado: EstadoPunchItem;
  createdAt: string;
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function apiErr(error: unknown): Error {
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: string };
    if (e.message) return new Error(e.message);
  }
  return new Error('Error en la API');
}

// ─── Partes Diarios ───────────────────────────────────────────────────────────

export function usePartesDiarios(proyectoId?: string) {
  return useQuery({
    queryKey: ['partes-diarios', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/obra/partes', {
        params: { query: proyectoId ? { proyectoId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as ParteDiario[]) ?? [];
    },
  });
}

export function useParteDiario(id: string) {
  return useQuery({
    queryKey: ['partes-diarios', id],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/obra/partes/{id}', {
        params: { path: { id } },
      });
      if (error) throw apiErr(error);
      return data as unknown as ParteDiario;
    },
    enabled: !!id,
  });
}

export function useCreateParteDiario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ParteDiarioCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/obra/partes', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as ParteDiario;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['partes-diarios'] }); },
  });
}

export function useConfirmarParte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/obra/partes/{id}/confirmar', {
        params: { path: { id } },
        body: {} as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as ParteDiario;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['partes-diarios'] }); },
  });
}

// ─── RFIs ─────────────────────────────────────────────────────────────────────

export function useRfis(proyectoId?: string) {
  return useQuery({
    queryKey: ['rfis', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/obra/rfis', {
        params: { query: proyectoId ? { proyectoId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as Rfi[]) ?? [];
    },
  });
}

export function useCreateRfi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RfiCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/obra/rfis', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Rfi;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rfis'] }); },
  });
}

export function useResponderRfi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: RfiResponderInput }) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/obra/rfis/{id}/responder', {
        params: { path: { id } },
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Rfi;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rfis'] }); },
  });
}

export function useCerrarRfi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/obra/rfis/{id}/cerrar', {
        params: { path: { id } },
        body: {} as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Rfi;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rfis'] }); },
  });
}

// ─── Punch List ───────────────────────────────────────────────────────────────

export function usePunchList(proyectoId?: string) {
  return useQuery({
    queryKey: ['punch-list', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/obra/punch-list', {
        params: { query: proyectoId ? { proyectoId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as PunchItem[]) ?? [];
    },
  });
}

export function useCreatePunchItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PunchListCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/obra/punch-list', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as PunchItem;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['punch-list'] }); },
  });
}

export function useActualizarEstadoPunch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: PunchListActualizarEstadoInput }) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/obra/punch-list/{id}/estado', {
        params: { path: { id } },
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as PunchItem;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['punch-list'] }); },
  });
}
