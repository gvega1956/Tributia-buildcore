import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api';
import type {
  CubicacionCreateInput,
  FacturaClienteCreateInput,
  CobroCxcInput,
  EstadoCubicacion,
  EstadoFacturaCliente,
  EstadoCxC,
} from '@tributia/cxc';

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export type CubicacionLinea = {
  id: string;
  partidaId: string;
  cantidadPeriodo: string;
  precioUnitario: string;
  subtotal: string;
};

export type Cubicacion = {
  id: string;
  empresaId: string;
  proyectoId: string;
  fechaCorte: string;
  estado: EstadoCubicacion;
  subtotal: string;
  moneda: string;
  lineas: CubicacionLinea[];
  createdAt: string;
};

export type RetencionCliente = {
  concepto: string;
  porcentaje: string;
  monto: string;
};

export type FacturaCliente = {
  id: string;
  cubicacionId: string;
  clienteId: string;
  numero: string;
  ncf: string | null;
  subtotal: string;
  itbis: string;
  retenciones: RetencionCliente[];
  total: string;
  fechaVencimiento: string;
  estado: EstadoFacturaCliente;
  moneda: string;
  createdAt: string;
};

export type CuentaPorCobrar = {
  id: string;
  terceroId: string;
  terceroNombre: string;
  proyectoId: string | null;
  facturaClienteId: string | null;
  monto: string;
  saldo: string;
  moneda: string;
  fechaVencimiento: string;
  estado: EstadoCxC;
  createdAt: string;
};

export type AgingBucket = {
  rango: string;
  total: string;
  count: number;
};

export type AgingPorCliente = {
  terceroId: string;
  nombre: string;
  total: string;
  buckets: AgingBucket[];
};

export type AgingPorProyecto = {
  proyectoId: string;
  nombre: string;
  total: string;
  buckets: AgingBucket[];
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function apiErr(error: unknown): Error {
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: string };
    if (e.message) return new Error(e.message);
  }
  return new Error('Error en la API');
}

// ─── Cubicaciones ─────────────────────────────────────────────────────────────

export function useCubicaciones(proyectoId?: string) {
  return useQuery({
    queryKey: ['cubicaciones', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/cxc/cubicaciones', {
        params: { query: proyectoId ? { proyectoId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as Cubicacion[]) ?? [];
    },
  });
}

export function useCubicacion(id: string) {
  return useQuery({
    queryKey: ['cubicaciones', id],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/cxc/cubicaciones/{id}', {
        params: { path: { id } },
      });
      if (error) throw apiErr(error);
      return data as unknown as Cubicacion;
    },
    enabled: !!id,
  });
}

export function useCreateCubicacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CubicacionCreateInput) => {
      const api = getApiClient();
      // Acción financiera — confirma éxito solo tras respuesta del servidor
      const { data, error } = await api.POST('/api/v1/cxc/cubicaciones', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Cubicacion;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cubicaciones'] }); },
  });
}

// ─── Facturas Cliente ─────────────────────────────────────────────────────────

export function useFacturasCliente(proyectoId?: string) {
  return useQuery({
    queryKey: ['facturas-cliente', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/cxc/facturas-cliente', {
        params: { query: proyectoId ? { proyectoId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as FacturaCliente[]) ?? [];
    },
  });
}

export function useFacturaCliente(id: string) {
  return useQuery({
    queryKey: ['facturas-cliente', id],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/cxc/facturas-cliente/{id}', {
        params: { path: { id } },
      });
      if (error) throw apiErr(error);
      return data as unknown as FacturaCliente;
    },
    enabled: !!id,
  });
}

export function useEmitirFactura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FacturaClienteCreateInput) => {
      const api = getApiClient();
      // Acción financiera — espera confirmación del servidor; no optimistic
      const { data, error } = await api.POST('/api/v1/cxc/facturas-cliente', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as FacturaCliente;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facturas-cliente'] });
      qc.invalidateQueries({ queryKey: ['cuentas-por-cobrar'] });
    },
  });
}

// ─── Cuentas por Cobrar ───────────────────────────────────────────────────────

export function useCuentasPorCobrar(params?: { terceroId?: string; proyectoId?: string }) {
  return useQuery({
    queryKey: ['cuentas-por-cobrar', params],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/cxc/cuentas-por-cobrar', {
        params: { query: (params ?? {}) as Record<string, string> },
      });
      if (error) throw apiErr(error);
      return (data as unknown as CuentaPorCobrar[]) ?? [];
    },
  });
}

export function useAgingPorCliente() {
  return useQuery({
    queryKey: ['aging-por-cliente'],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/cxc/cuentas-por-cobrar/aging/por-cliente', {});
      if (error) throw apiErr(error);
      return (data as unknown as AgingPorCliente[]) ?? [];
    },
  });
}

export function useAgingPorProyecto() {
  return useQuery({
    queryKey: ['aging-por-proyecto'],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/cxc/cuentas-por-cobrar/aging/por-proyecto', {});
      if (error) throw apiErr(error);
      return (data as unknown as AgingPorProyecto[]) ?? [];
    },
  });
}

export function useRegistrarCobroCxC() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: CobroCxcInput }) => {
      const api = getApiClient();
      // Acción financiera — espera confirmación del servidor
      const { data, error } = await api.POST('/api/v1/cxc/cuentas-por-cobrar/{id}/cobro', {
        params: { path: { id } },
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as CuentaPorCobrar;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cuentas-por-cobrar'] });
      qc.invalidateQueries({ queryKey: ['aging-por-cliente'] });
      qc.invalidateQueries({ queryKey: ['aging-por-proyecto'] });
    },
  });
}

export type { EstadoCubicacion, EstadoFacturaCliente, EstadoCxC };
