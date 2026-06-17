import Decimal from 'decimal.js';
import type { DatosReconciliacionIT1, PeriodoFiscal, ReporteIT1 } from './reporte-dgii.types.js';

/**
 * Genera el IT-1 (declaración mensual de ITBIS).
 *
 * Fórmula:
 *   ITBIS a pagar = cobrado − adelantado − retenidoPorEstado
 *
 * Reconciliación contra el libro mayor:
 *   La diferencia debe ser 0 si "un hecho, todas las consecuencias" se cumplió.
 *   Si difiere, el ledger tiene asientos faltantes o incorrectos.
 *
 * @param itbisCobrado     Sum(comprobante_ecf.monto_itbis) WHERE tipo IN (E31,E32) y ACEPTADO
 * @param itbisAdelantado  Sum(factura_proveedor.monto_itbis) WHERE tipoEcf IN (E31,B01) y validado
 * @param itbisRetenidoPorEstado  Sum(factura_cliente.monto_retencion_itbis) WHERE cliente estatal
 * @param reconciliacion   Net CR de cuenta 2102 y Net DR de cuenta 1106 del período
 */
export function generarReporteIT1(
  rncEmpresa: string,
  periodo: PeriodoFiscal,
  itbisCobrado: string,
  itbisAdelantado: string,
  itbisRetenidoPorEstado: string,
  reconciliacion: DatosReconciliacionIT1,
): ReporteIT1 {
  const cobrado = new Decimal(itbisCobrado);
  const adelantado = new Decimal(itbisAdelantado);
  const retenidoPorEstado = new Decimal(itbisRetenidoPorEstado);
  const aPagar = cobrado.minus(adelantado).minus(retenidoPorEstado);

  const contablePorPagar = new Decimal(reconciliacion.itbisPorPagarContable);
  const contableAdelantado = new Decimal(reconciliacion.itbisAdelantadoContable);

  // diferencia = IT-1 fiscal − IT-1 contable
  // Si el ledger está correcto: cobrado contable == cobrado fiscal y adelantado coincide.
  const diferenciaFiscal = cobrado.minus(contablePorPagar);
  const diferenciaAdelantado = adelantado.minus(contableAdelantado);
  const diferencia = diferenciaFiscal.plus(diferenciaAdelantado);

  return {
    rncEmpresa,
    periodo,
    itbisCobrado: cobrado.toFixed(4),
    itbisAdelantado: adelantado.toFixed(4),
    itbisRetenidoPorEstado: retenidoPorEstado.toFixed(4),
    itbisAPagar: aPagar.toFixed(4),
    reconciliacion: {
      itbisPorPagarContable: contablePorPagar.toFixed(4),
      itbisAdelantadoContable: contableAdelantado.toFixed(4),
      diferencia: diferencia.toFixed(4),
      cuadra: diferencia.abs().lessThanOrEqualTo('0.0100'), // tolerancia de 1 centavo por redondeos
    },
  };
}
