import { z } from 'zod';

const zUUID = z.string().uuid();
const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con máximo 4 decimales');
const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser YYYY-MM-DD');
const zMoneda = z.enum(['DOP', 'USD', 'EUR']);

// ─── Cuentas bancarias ────────────────────────────────────────────────────────

export const zCrearCuentaBancaria = z.object({
  empresaId: zUUID,
  bancoNombre: z.string().min(1).max(200),
  numeroCuenta: z.string().min(1).max(50),
  tipoCuenta: z.enum(['CORRIENTE', 'AHORROS']).optional(),
  moneda: zMoneda.optional(),
  cuentaContableCodigo: z.string().min(1).max(20),
});

export type CrearCuentaBancariaInput = z.infer<typeof zCrearCuentaBancaria>;

// ─── Cobros ───────────────────────────────────────────────────────────────────

const zMonto = z.object({ amount: zDecimal, currency: z.string().length(3) });

export const zRegistrarCobro = z.object({
  empresaId: zUUID,
  proyectoId: zUUID.optional(),
  centroCostoId: zUUID.optional(),
  cuentaBancariaId: zUUID,
  facturaClienteId: zUUID.optional(),
  montoCobrado: zMonto,
  tasaFactura: zDecimal,
  tasaCobro: zDecimal,
  monedaBase: zMoneda,
  aplicaciones: z.array(z.object({
    cuentaPorCobrarId: zUUID,
    monto: zMonto,
  })).optional(),
  referenciaBancaria: z.string().max(100).optional(),
});

export type RegistrarCobroInput = z.infer<typeof zRegistrarCobro>;

// ─── Conciliación ─────────────────────────────────────────────────────────────

export const zLineaExtracto = z.object({
  fecha: zFecha,
  descripcion: z.string().min(1).max(500),
  monto: zDecimal,
  referencia: z.string().max(100).optional(),
});

export const zImportarExtracto = z.object({
  cuentaBancariaId: zUUID,
  empresaId: zUUID,
  periodoDesde: zFecha,
  periodoHasta: zFecha,
  archivoNombre: z.string().min(1).max(255),
  lineas: z.array(zLineaExtracto),
});

export type LineaExtractoInput = z.infer<typeof zLineaExtracto>;
export type ImportarExtractoInput = z.infer<typeof zImportarExtracto>;

// ─── Caja chica ───────────────────────────────────────────────────────────────

export const zCrearFondoCajaChica = z.object({
  empresaId: zUUID,
  proyectoId: zUUID,
  responsableId: zUUID,
  cuentaBancariaOrigenId: zUUID,
  montoAsignado: zDecimal,
  moneda: zMoneda.optional(),
});

export const zRegistrarGastoCajaChica = z.object({
  empresaId: zUUID,
  proyectoId: zUUID,
  fecha: zFecha,
  monto: zDecimal,
  moneda: zMoneda.optional(),
  concepto: z.string().min(1).max(500),
  numeroComprobante: z.string().min(1).max(50),
  tipoComprobante: z.enum(['FACTURA', 'RECIBO', 'NCF', 'OTRO']),
  proveedorTerceroId: zUUID.optional(),
  partidaId: zUUID.optional(),
});

export const zSolicitarReposicion = z.object({
  monto: zDecimal,
  moneda: zMoneda.optional(),
});

export type CrearFondoCajaChicaInput = z.infer<typeof zCrearFondoCajaChica>;
export type RegistrarGastoCajaChicaInput = z.infer<typeof zRegistrarGastoCajaChica>;
export type SolicitarReposicionInput = z.infer<typeof zSolicitarReposicion>;

// ─── Programación de pagos ────────────────────────────────────────────────────

export const zProgramarPago = z.object({
  empresaId: zUUID,
  cuentaPorPagarId: zUUID,
  cuentaBancariaId: zUUID,
  monto: zDecimal,
  moneda: zMoneda.optional(),
  fechaProgramada: zFecha,
  prioridad: z.number().int().positive().optional(),
  proyectoId: zUUID.optional(),
  centroCostoId: zUUID.optional(),
});

export type ProgramarPagoInput = z.infer<typeof zProgramarPago>;

// ─── Cubicación proyectada (flujo caja) ──────────────────────────────────────

export const zCubicacionProyectada = z.object({
  empresaId: zUUID,
  proyectoId: zUUID,
  fechaProyectada: zFecha,
  montoProyectado: zDecimal,
  moneda: zMoneda.optional(),
  descripcion: z.string().max(500).optional(),
});

export type CubicacionProyectadaInput = z.infer<typeof zCubicacionProyectada>;

// ─── Tipos estado ─────────────────────────────────────────────────────────────

export type TipoCuenta = 'CORRIENTE' | 'AHORROS';
export type TipoComprobante = 'FACTURA' | 'RECIBO' | 'NCF' | 'OTRO';
