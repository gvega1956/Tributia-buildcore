import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api';
import { validarBalance } from '@tributia/contabilidad';
import type { AsientoAjusteCreateInput } from '@tributia/contabilidad';

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export type LineaAsiento = {
  id: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  tipo: 'debe' | 'haber';
  importe: string;
  moneda: string;
  descripcion: string | null;
};

export type AsientoContable = {
  id: string;
  empresaId: string;
  tipo: 'automatico' | 'ajuste' | 'apertura' | 'cierre';
  fecha: string;
  descripcion: string;
  estado: 'borrador' | 'confirmado' | 'reversado';
  eventoId: string | null;
  lineas: LineaAsiento[];
};

export type EntradasLibroDiario = {
  asientos: AsientoContable[];
  total: number;
};

export type LineaLibroMayor = {
  fecha: string;
  asientoId: string;
  descripcion: string;
  debe: string | null;
  haber: string | null;
  saldo: string;
};

export type LibroMayor = {
  cuentaId: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  saldoInicial: string;
  lineas: LineaLibroMayor[];
  saldoFinal: string;
};

export type FilaBalanza = {
  cuentaCodigo: string;
  cuentaNombre: string;
  totalDebe: string;
  totalHaber: string;
  saldoDeudor: string;
  saldoAcreedor: string;
};

export type Balanza = {
  filas: FilaBalanza[];
  totalDebe: string;
  totalHaber: string;
  cuadra: boolean;
};

export type SeccionEstado = {
  titulo: string;
  subtotal: string;
  partidas: { descripcion: string; importe: string }[];
};

export type BalanceGeneral = {
  fechaCorte: string;
  activo: SeccionEstado[];
  pasivo: SeccionEstado[];
  patrimonio: SeccionEstado[];
  totalActivo: string;
  totalPasivoPatrimonio: string;
  cuadra: boolean;
};

export type EstadoResultados = {
  fechaDesde: string;
  fechaHasta: string;
  ingresos: SeccionEstado[];
  costos: SeccionEstado[];
  gastos: SeccionEstado[];
  utilidadBruta: string;
  utilidadOperativa: string;
  utilidadNeta: string;
};

// ─── Cuenta contable (para selector) ─────────────────────────────────────────

export type CuentaContable = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
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

export function useLibroDiario(params: {
  fechaDesde: string;
  fechaHasta: string;
  cuentaId?: string;
  proyectoId?: string;
}) {
  return useQuery({
    queryKey: ['libro-diario', params],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/contabilidad/libro-diario', {
        params: { query: params as Record<string, string> },
      });
      if (error) throw apiErr(error);
      return (data as unknown as AsientoContable[]) ?? [];
    },
    enabled: !!params.fechaDesde && !!params.fechaHasta,
  });
}

export function useLibroMayor(cuentaId: string, params: { fechaDesde: string; fechaHasta: string }) {
  return useQuery({
    queryKey: ['libro-mayor', cuentaId, params],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/contabilidad/libro-mayor/{cuentaId}', {
        params: { path: { cuentaId }, query: params as Record<string, string> },
      });
      if (error) throw apiErr(error);
      return data as unknown as LibroMayor;
    },
    enabled: !!cuentaId && !!params.fechaDesde && !!params.fechaHasta,
  });
}

export function useBalanza(params: { fechaDesde: string; fechaHasta: string }) {
  return useQuery({
    queryKey: ['balanza', params],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/contabilidad/balanza', {
        params: { query: params as Record<string, string> },
      });
      if (error) throw apiErr(error);
      return data as unknown as Balanza;
    },
    enabled: !!params.fechaDesde && !!params.fechaHasta,
  });
}

export function useDetalleAsiento(id: string) {
  return useQuery({
    queryKey: ['asiento', id],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/contabilidad/asientos/{id}', {
        params: { path: { id } },
      });
      if (error) throw apiErr(error);
      return data as unknown as AsientoContable;
    },
    enabled: !!id,
  });
}

export function useBalanceGeneral(fechaCorte: string) {
  return useQuery({
    queryKey: ['balance-general', fechaCorte],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/contabilidad/balance-general', {
        params: { query: { fechaCorte } },
      });
      if (error) throw apiErr(error);
      return data as unknown as BalanceGeneral;
    },
    enabled: !!fechaCorte,
  });
}

export function useEstadoResultados(params: {
  fechaDesde: string;
  fechaHasta: string;
  proyectoId?: string;
}) {
  return useQuery({
    queryKey: ['estado-resultados', params],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/contabilidad/estado-resultados', {
        params: { query: params as Record<string, string> },
      });
      if (error) throw apiErr(error);
      return data as unknown as EstadoResultados;
    },
    enabled: !!params.fechaDesde && !!params.fechaHasta,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useRegistrarAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AsientoAjusteCreateInput) => {
      // Validación doble en frontend: el asiento debe cuadrar antes de enviarse
      const ok = validarBalance(input.lineas.map((l) => ({
        cuentaCodigo: l.cuentaCodigo,
        tipo: l.tipo,
        importe: l.importe,
        moneda: l.moneda ?? 'DOP',
      })));
      if (!ok) throw new Error('El asiento no cuadra: Σdebe ≠ Σhaber');

      const api = getApiClient();
      // Acción financiera — espera confirmación del servidor antes de reportar éxito
      const { data, error } = await api.POST('/api/v1/contabilidad/asientos/ajuste', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as AsientoContable;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['libro-diario'] });
      qc.invalidateQueries({ queryKey: ['balanza'] });
    },
  });
}

export { validarBalance };
