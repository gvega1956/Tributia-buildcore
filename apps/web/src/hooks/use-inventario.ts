import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api';
import type { AlmacenCreateInput, AlmacenUpdateInput, ConteoFisicoCreateInput } from '@tributia/inventario';

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export type TipoAlmacen = 'CENTRAL' | 'OBRA' | 'TRANSITO';

export type Almacen = {
  id: string;
  empresaId: string;
  proyectoId: string | null;
  tipo: TipoAlmacen;
  codigo: string;
  nombre: string;
  ubicacionFisica: string | null;
  activo: boolean;
  createdAt: string;
};

export type StockItem = {
  insumoId: string;
  almacenId: string;
  nombreInsumo: string;
  codigoInsumo: string | null;
  unidadMedida: string;
  cantidadDisponible: string;
  costoPromedio: string;
  moneda: string;
};

export type MovimientoInventario = {
  id: string;
  almacenId: string;
  insumoId: string;
  tipoMovimiento: string;
  cantidad: string;
  costoUnitario: string;
  costoTotal: string;
  moneda: string;
  referencia: string | null;
  createdAt: string;
};

export type KardexLinea = {
  fecha: string;
  tipoMovimiento: string;
  entrada: string | null;
  salida: string | null;
  saldo: string;
  costoUnitario: string;
  costoTotal: string;
  costoPromedio: string;
  referencia: string | null;
};

export type ConteoFisico = {
  id: string;
  empresaId: string;
  almacenId: string;
  fechaConteo: string;
  estado: 'BORRADOR' | 'FINALIZADO' | 'CANCELADO';
  notas: string | null;
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

// ─── Almacenes ────────────────────────────────────────────────────────────────

export function useAlmacenes() {
  return useQuery({
    queryKey: ['almacenes'],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/inventario/almacenes');
      if (error) throw apiErr(error);
      return (data as unknown as Almacen[]) ?? [];
    },
  });
}

export function useCreateAlmacen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AlmacenCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/inventario/almacenes', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Almacen;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['almacenes'] }); },
  });
}

export function useUpdateAlmacen(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AlmacenUpdateInput) => {
      const api = getApiClient();
      const { data, error } = await api.PATCH('/api/v1/inventario/almacenes/{id}', {
        params: { path: { id } },
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as Almacen;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['almacenes'] }); },
  });
}

// ─── Stock ────────────────────────────────────────────────────────────────────

export function useStockAlmacen(almacenId: string) {
  return useQuery({
    queryKey: ['stock', almacenId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/inventario/almacenes/{almacenId}/stock', {
        params: { path: { almacenId } },
      });
      if (error) throw apiErr(error);
      return (data as unknown as StockItem[]) ?? [];
    },
    enabled: !!almacenId,
  });
}

// ─── Movimientos ──────────────────────────────────────────────────────────────

export function useMovimientos(almacenId?: string) {
  return useQuery({
    queryKey: ['movimientos', almacenId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/inventario/movimientos', {
        params: { query: almacenId ? { almacenId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as MovimientoInventario[]) ?? [];
    },
  });
}

// ─── Kardex ───────────────────────────────────────────────────────────────────

export function useKardex(almacenId: string, insumoId: string) {
  return useQuery({
    queryKey: ['kardex', almacenId, insumoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET(
        '/api/v1/inventario/almacenes/{almacenId}/kardex/{insumoId}',
        { params: { path: { almacenId, insumoId } } },
      );
      if (error) throw apiErr(error);
      return (data as unknown as KardexLinea[]) ?? [];
    },
    enabled: !!almacenId && !!insumoId,
  });
}

// ─── Conteos físicos ──────────────────────────────────────────────────────────

export function useConteos() {
  return useQuery({
    queryKey: ['conteos'],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/inventario/conteos');
      if (error) throw apiErr(error);
      return (data as unknown as ConteoFisico[]) ?? [];
    },
  });
}

export function useCreateConteo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConteoFisicoCreateInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/inventario/conteos', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as ConteoFisico;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conteos'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });
}
