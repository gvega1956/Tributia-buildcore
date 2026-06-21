import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api';
import type {
  RequisicionCreateInput,
  SocCreateInput,
  CotizacionCreateInput,
  OrdenCompraCreateInput,
  RecepcionOcCreateInput,
  FacturaProveedorCreateInput,
} from '@tributia/compras';

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export type EstadoRequisicion = 'BORRADOR' | 'ENVIADA' | 'PROCESADA';

export type Requisicion = {
  id: string;
  tenantId: string;
  empresaId: string;
  proyectoId: string;
  estado: EstadoRequisicion;
  fechaRequerida: string | null;
  notas: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SolicitudCotizacion = {
  id: string;
  empresaId: string;
  estado: 'BORRADOR' | 'ENVIADA' | 'CERRADA';
  fechaVencimiento: string | null;
  notas: string | null;
  createdAt: string;
};

export type Cotizacion = {
  id: string;
  socId: string;
  terceroId: string;
  numeroCotizacionProveedor: string | null;
  estado: 'RECIBIDA' | 'SELECCIONADA' | 'DESCARTADA';
  fechaEmision: string | null;
  createdAt: string;
};

export type EstadoOrdenCompra =
  | 'BORRADOR'
  | 'PENDIENTE_APROBACION'
  | 'APROBADA'
  | 'EMITIDA'
  | 'RECIBIDA_PARCIAL'
  | 'RECIBIDA_TOTAL'
  | 'CANCELADA';

export type OrdenCompra = {
  id: string;
  empresaId: string;
  terceroId: string;
  cotizacionId: string | null;
  estado: EstadoOrdenCompra;
  fechaEmision: string | null;
  fechaEntregaPrometida: string | null;
  condicionesPago: string | null;
  notas: string | null;
  createdAt: string;
};

export type EstadoMatch = 'OK' | 'PRECIO_DISCREPANTE' | 'CANTIDAD_DISCREPANTE' | 'AMBOS_DISCREPANTES' | 'SIN_OC';

export type FacturaProveedor = {
  id: string;
  empresaId: string;
  terceroId: string;
  numero: string;
  ncf: string;
  estado: 'PENDIENTE_VALIDACION' | 'VALIDADA' | 'CON_DISCREPANCIAS' | 'APROBADA_EXCEPCION';
  estadoMatch: EstadoMatch | null;
  montoSubtotal: string;
  montoItbis: string;
  montoTotal: string;
  moneda: string;
  fechaFactura: string;
  createdAt: string;
};

export type CuentaPorPagar = {
  id: string;
  empresaId: string;
  terceroId: string;
  facturaProveedorId: string;
  montoOriginal: string;
  saldoPendiente: string;
  moneda: string;
  estado: 'ABIERTA' | 'PAGADA_PARCIAL' | 'PAGADA_TOTAL';
  fechaVencimientoPago: string | null;
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

// ─── Requisiciones ────────────────────────────────────────────────────────────

export function useRequisiciones(proyectoId?: string) {
  return useQuery({
    queryKey: ['requisiciones', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/compras/requisiciones', {
        params: { query: proyectoId ? { proyectoId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as Requisicion[]) ?? [];
    },
  });
}

export function useCreateRequisicion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RequisicionCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/compras/requisiciones', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Requisicion;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['requisiciones'] }); },
  });
}

export function useSubmitRequisicion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/compras/requisiciones/{id}/submit', {
        params: { path: { id } },
        body: {} as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Requisicion;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['requisiciones'] }); },
  });
}

// ─── Solicitudes de Cotización ────────────────────────────────────────────────

export function useSolicitudesCotizacion(empresaId?: string) {
  return useQuery({
    queryKey: ['solicitudes-cotizacion', empresaId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/compras/solicitudes-cotizacion', {
        params: { query: empresaId ? { empresaId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as SolicitudCotizacion[]) ?? [];
    },
  });
}

export function useCreateSoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SocCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/compras/solicitudes-cotizacion', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as SolicitudCotizacion;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['solicitudes-cotizacion'] }); },
  });
}

export function useEnviarSoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/compras/solicitudes-cotizacion/{id}/enviar', {
        params: { path: { id } },
        body: {} as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as SolicitudCotizacion;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['solicitudes-cotizacion'] }); },
  });
}

// ─── Cotizaciones ─────────────────────────────────────────────────────────────

export function useCotizaciones(socId?: string) {
  return useQuery({
    queryKey: ['cotizaciones', socId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/compras/cotizaciones', {
        params: { query: socId ? { socId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as Cotizacion[]) ?? [];
    },
    enabled: true,
  });
}

export function useCreateCotizacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CotizacionCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/compras/cotizaciones', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Cotizacion;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cotizaciones'] }); },
  });
}

export function useSeleccionarCotizacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/compras/cotizaciones/{id}/seleccionar', {
        params: { path: { id } },
        body: {} as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Cotizacion;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cotizaciones'] }); },
  });
}

// ─── Órdenes de Compra ────────────────────────────────────────────────────────

export function useOrdenesCompra(empresaId?: string) {
  return useQuery({
    queryKey: ['ordenes-compra', empresaId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/compras/ordenes-compra', {
        params: { query: empresaId ? { empresaId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as OrdenCompra[]) ?? [];
    },
  });
}

export function useOrdenCompra(id: string) {
  return useQuery({
    queryKey: ['ordenes-compra', id],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/compras/ordenes-compra/{id}', {
        params: { path: { id } },
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCompra;
    },
    enabled: !!id,
  });
}

export function useCreateOrdenCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OrdenCompraCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/compras/ordenes-compra', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCompra;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ordenes-compra'] }); },
  });
}

export function useAprobarOrdenCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/compras/ordenes-compra/{id}/aprobar', {
        params: { path: { id } },
        body: {} as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCompra;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ordenes-compra'] }); },
  });
}

export function useEmitirOrdenCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/compras/ordenes-compra/{id}/emitir', {
        params: { path: { id } },
        body: {} as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as OrdenCompra;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ordenes-compra'] }); },
  });
}

// ─── Recepción OC ─────────────────────────────────────────────────────────────

export function useCreateRecepcion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecepcionOcCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/compras/recepciones', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ordenes-compra'] });
      qc.invalidateQueries({ queryKey: ['facturas'] });
    },
  });
}

// ─── Facturas Proveedor ───────────────────────────────────────────────────────

export function useFacturasProveedor(empresaId?: string) {
  return useQuery({
    queryKey: ['facturas', empresaId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/compras/facturas-proveedor', {
        params: { query: empresaId ? { empresaId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as FacturaProveedor[]) ?? [];
    },
  });
}

export function useCreateFactura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FacturaProveedorCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/compras/facturas-proveedor', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as FacturaProveedor;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facturas'] });
      qc.invalidateQueries({ queryKey: ['cuentas-por-pagar'] });
    },
  });
}

// ─── Cuentas por Pagar ────────────────────────────────────────────────────────

export function useCuentasPorPagar() {
  return useQuery({
    queryKey: ['cuentas-por-pagar'],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/compras/cuentas-por-pagar');
      if (error) throw apiErr(error);
      return (data as unknown as CuentaPorPagar[]) ?? [];
    },
  });
}
