import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api';
import type {
  CrearCuentaBancariaInput,
  RegistrarCobroInput,
  ImportarExtractoInput,
  CrearFondoCajaChicaInput,
  RegistrarGastoCajaChicaInput,
  SolicitarReposicionInput,
  ProgramarPagoInput,
  CubicacionProyectadaInput,
} from '@tributia/tesoreria';

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export type CuentaBancaria = {
  id: string;
  bancoNombre: string;
  numeroCuenta: string;
  tipoCuenta: string | null;
  moneda: string;
  cuentaContableCodigo: string;
  saldo: string;
  activa: boolean;
};

export type MovimientoBancario = {
  id: string;
  fecha: string;
  descripcion: string;
  tipo: 'CREDITO' | 'DEBITO';
  monto: string;
  moneda: string;
  referencia: string | null;
  conciliado: boolean;
};

export type LineaExtracto = {
  id: string;
  fecha: string;
  descripcion: string;
  monto: string;
  referencia: string | null;
  estado: 'PENDIENTE' | 'CONCILIADA' | 'IGNORADA';
  movimientoBancarioId: string | null;
};

export type ExtractoBancario = {
  id: string;
  cuentaBancariaId: string;
  archivoNombre: string;
  periodoDesde: string;
  periodoHasta: string;
  lineas: LineaExtracto[];
  createdAt: string;
};

export type FondoCajaChica = {
  id: string;
  proyectoId: string;
  responsableId: string;
  montoAsignado: string;
  saldoActual: string;
  moneda: string;
  activo: boolean;
};

export type GastoCajaChica = {
  id: string;
  fondoId: string;
  fecha: string;
  monto: string;
  concepto: string;
  numeroComprobante: string;
  tipoComprobante: string;
};

export type ProgramacionPago = {
  id: string;
  cuentaPorPagarId: string;
  cuentaBancariaId: string;
  monto: string;
  moneda: string;
  fechaProgramada: string;
  prioridad: number;
  ejecutado: boolean;
};

export type SemanaFlujo = {
  semana: string;
  fechaInicio: string;
  fechaFin: string;
  ingresos: string;
  egresos: string;
  neto: string;
  saldoAcumulado: string;
  alertaDeficit: boolean;
};

export type FlujoCaja = {
  proyectoId: string | null;
  saldoInicial: string;
  semanas: SemanaFlujo[];
  saldoFinal: string;
};

export type CubicacionProyectada = {
  id: string;
  proyectoId: string;
  fechaProyectada: string;
  montoProyectado: string;
  moneda: string;
  descripcion: string | null;
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function apiErr(error: unknown): Error {
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: string };
    if (e.message) return new Error(e.message);
  }
  return new Error('Error en la API');
}

// ─── Cuentas bancarias ────────────────────────────────────────────────────────

export function useCuentasBancarias(empresaId?: string) {
  return useQuery({
    queryKey: ['cuentas-bancarias', empresaId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/tesoreria/cuentas-bancarias', {
        params: { query: empresaId ? { empresaId } : undefined },
      });
      if (error) throw apiErr(error);
      return (data as unknown as CuentaBancaria[]) ?? [];
    },
  });
}

export function useMovimientosBancarios(cuentaId: string) {
  return useQuery({
    queryKey: ['movimientos-bancarios', cuentaId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/tesoreria/cuentas-bancarias/{id}/movimientos', {
        params: { path: { id: cuentaId } },
      });
      if (error) throw apiErr(error);
      return (data as unknown as MovimientoBancario[]) ?? [];
    },
    enabled: !!cuentaId,
  });
}

export function useCrearCuentaBancaria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CrearCuentaBancariaInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/tesoreria/cuentas-bancarias', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as CuentaBancaria;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cuentas-bancarias'] }); },
  });
}

// ─── Cobros ───────────────────────────────────────────────────────────────────

export function useRegistrarCobro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegistrarCobroInput) => {
      const api = getApiClient();
      // Acción financiera — espera confirmación del servidor
      const { data, error } = await api.POST('/api/v1/tesoreria/cobros', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as MovimientoBancario;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movimientos-bancarios'] });
      qc.invalidateQueries({ queryKey: ['cuentas-bancarias'] });
    },
  });
}

// ─── Conciliación ─────────────────────────────────────────────────────────────

export function useImportarExtracto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ImportarExtractoInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/tesoreria/conciliacion/extractos', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as ExtractoBancario;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['extractos'] }); },
  });
}

export function useConciliarAutomatico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (extractoId: string) => {
      const api = getApiClient();
      const { data, error } = await api.POST(
        '/api/v1/tesoreria/conciliacion/extractos/{extractoId}/conciliar-automatico',
        { params: { path: { extractoId } }, body: {} as never },
      );
      if (error) throw apiErr(error);
      return data as unknown as ExtractoBancario;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['extractos'] }); },
  });
}

export function useConciliarManual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ lineaId, movimientoBancarioId }: { lineaId: string; movimientoBancarioId: string }) => {
      const api = getApiClient();
      const { data, error } = await api.POST(
        '/api/v1/tesoreria/conciliacion/lineas/{lineaId}/conciliar-manual',
        { params: { path: { lineaId } }, body: { movimientoBancarioId } as never },
      );
      if (error) throw apiErr(error);
      return data as unknown as LineaExtracto;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['extractos'] }); },
  });
}

export function useIgnorarLinea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lineaId: string) => {
      const api = getApiClient();
      const { data, error } = await api.POST(
        '/api/v1/tesoreria/conciliacion/lineas/{lineaId}/ignorar',
        { params: { path: { lineaId } }, body: {} as never },
      );
      if (error) throw apiErr(error);
      return data as unknown as LineaExtracto;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['extractos'] }); },
  });
}

// ─── Caja chica ───────────────────────────────────────────────────────────────

export function useCrearFondoCajaChica() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CrearFondoCajaChicaInput) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/tesoreria/fondos-caja-chica', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as FondoCajaChica;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fondos-caja-chica'] }); },
  });
}

export function useRegistrarGastoCajaChica() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fondoId, input }: { fondoId: string; input: RegistrarGastoCajaChicaInput }) => {
      const api = getApiClient();
      const { data, error } = await api.POST(
        '/api/v1/tesoreria/fondos-caja-chica/{fondoId}/gastos',
        { params: { path: { fondoId } }, body: input as never },
      );
      if (error) throw apiErr(error);
      return data as unknown as GastoCajaChica;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fondos-caja-chica'] }); },
  });
}

export function useSolicitarReposicion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fondoId, input }: { fondoId: string; input: SolicitarReposicionInput }) => {
      const api = getApiClient();
      const { data, error } = await api.POST(
        '/api/v1/tesoreria/fondos-caja-chica/{fondoId}/reposiciones',
        { params: { path: { fondoId } }, body: input as never },
      );
      if (error) throw apiErr(error);
      return data as unknown as { id: string };
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fondos-caja-chica'] }); },
  });
}

export function useEjecutarReposicion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reposicionId: string) => {
      const api = getApiClient();
      const { data, error } = await api.POST(
        '/api/v1/tesoreria/reposiciones/{reposicionId}/ejecutar',
        { params: { path: { reposicionId } }, body: {} as never },
      );
      if (error) throw apiErr(error);
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fondos-caja-chica'] }); },
  });
}

// ─── Programación de pagos ────────────────────────────────────────────────────

export function useProgramarPago() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProgramarPagoInput) => {
      const api = getApiClient();
      // Acción financiera — espera confirmación
      const { data, error } = await api.POST('/api/v1/tesoreria/programacion-pagos', {
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as ProgramacionPago;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['programacion-pagos'] }); },
  });
}

export function useEjecutarLotePagos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cuentaBancariaId: string) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/tesoreria/programacion-pagos/ejecutar-lote', {
        body: { cuentaBancariaId } as never,
      });
      if (error) throw apiErr(error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programacion-pagos'] });
      qc.invalidateQueries({ queryKey: ['movimientos-bancarios'] });
    },
  });
}

// ─── Flujo de caja ────────────────────────────────────────────────────────────

export function useFlujoCajaPorProyecto(proyectoId: string, horizonte = 13) {
  return useQuery({
    queryKey: ['flujo-caja', proyectoId, horizonte],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/proyectos/{proyectoId}/flujo-caja', {
        params: { path: { proyectoId }, query: { horizonte: String(horizonte) } },
      });
      if (error) throw apiErr(error);
      return data as unknown as FlujoCaja;
    },
    enabled: !!proyectoId,
  });
}

export function useFlujoCajaConsolidado(empresaId: string, horizonte = 13) {
  return useQuery({
    queryKey: ['flujo-caja-consolidado', empresaId, horizonte],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/tesoreria/flujo-caja', {
        params: { query: { empresaId, horizonte: String(horizonte) } },
      });
      if (error) throw apiErr(error);
      return data as unknown as FlujoCaja;
    },
    enabled: !!empresaId,
  });
}

export function useCubicacionesProyectadas(proyectoId: string) {
  return useQuery({
    queryKey: ['cubicaciones-proyectadas', proyectoId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/proyectos/{proyectoId}/cubicaciones-proyectadas', {
        params: { path: { proyectoId } },
      });
      if (error) throw apiErr(error);
      return (data as unknown as CubicacionProyectada[]) ?? [];
    },
    enabled: !!proyectoId,
  });
}

export function useRegistrarCubicacionProyectada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ proyectoId, input }: { proyectoId: string; input: CubicacionProyectadaInput }) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/proyectos/{proyectoId}/cubicaciones-proyectadas', {
        params: { path: { proyectoId } },
        body: input as never,
      });
      if (error) throw apiErr(error);
      return data as unknown as CubicacionProyectada;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['cubicaciones-proyectadas', v.proyectoId] });
      qc.invalidateQueries({ queryKey: ['flujo-caja', v.proyectoId] });
    },
  });
}

export function useEliminarCubicacionProyectada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ proyectoId, id }: { proyectoId: string; id: string }) => {
      const api = getApiClient();
      const { data, error } = await api.DELETE(
        '/api/v1/proyectos/{proyectoId}/cubicaciones-proyectadas/{id}',
        { params: { path: { proyectoId, id } } },
      );
      if (error) throw apiErr(error);
      return data;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['cubicaciones-proyectadas', v.proyectoId] });
      qc.invalidateQueries({ queryKey: ['flujo-caja', v.proyectoId] });
    },
  });
}
