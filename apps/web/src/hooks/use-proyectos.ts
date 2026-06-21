import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api';
import type {
  EstadoProyecto,
  TipoObra,
  ProyectoCreateInput,
  ProyectoUpdateInput,
} from '@tributia/proyectos';

// Response type matching ProyectoSelect returned by the API
export type Proyecto = {
  id: string;
  tenantId: string;
  empresaId: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  estado: EstadoProyecto;
  tipoObra: TipoObra;
  clienteId: string;
  numeroContrato: string | null;
  montoContrato: string | null;
  monedaContrato: string;
  fechaInicioPlanificada: string | null;
  fechaFinPlanificada: string | null;
  fechaInicioReal: string | null;
  fechaFinReal: string | null;
  ubicacionDescripcion: string | null;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TerceroCliente = {
  id: string;
  nombre: string;
  rnc: string | null;
  esCliente: boolean;
};

function apiErr(error: unknown): Error {
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: string };
    if (e.message) return new Error(e.message);
  }
  return new Error('Error en la API');
}

export function useProyectos() {
  return useQuery({
    queryKey: ['proyectos'],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/proyectos');
      if (error) throw apiErr(error);
      return (data as unknown as Proyecto[]) ?? [];
    },
  });
}

export function useProyecto(id: string) {
  return useQuery({
    queryKey: ['proyectos', id],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/proyectos/{id}', {
        params: { path: { id } },
      });
      if (error) throw apiErr(error);
      return data as unknown as Proyecto;
    },
    enabled: !!id,
  });
}

export function useTercerosClientes() {
  return useQuery({
    queryKey: ['terceros', 'clientes'],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/terceros');
      if (error) throw apiErr(error);
      const todos = (data as unknown as TerceroCliente[]) ?? [];
      return todos.filter((t) => t.esCliente);
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateProyecto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProyectoCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/proyectos', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Proyecto;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proyectos'] });
    },
  });
}

export function useUpdateProyecto(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProyectoUpdateInput) => {
      const api = getApiClient();
      const { data, error } = await api.PUT('/api/v1/proyectos/{id}', {
        params: { path: { id } },
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Proyecto;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proyectos'] });
      qc.invalidateQueries({ queryKey: ['proyectos', id] });
    },
  });
}

export function useTransicionarEstado(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (estado: EstadoProyecto) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/proyectos/{id}/estado', {
        params: { path: { id } },
        body: { estado },
      });
      if (error) throw apiErr(error);
      return data as unknown as Proyecto;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proyectos'] });
      qc.invalidateQueries({ queryKey: ['proyectos', id] });
    },
  });
}
