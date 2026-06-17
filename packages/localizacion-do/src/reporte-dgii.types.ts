/**
 * Tipos para los reportes fiscales DGII (§17 arquitectura.md).
 *
 * Solo tipos y DTOs — sin I/O. Los generadores usan estos tipos como
 * contrato entre el servicio de BD (apps/api) y la lógica pura (este paquete).
 *
 * Reportes implementados:
 *   606 — Compras (facturas de proveedor del período)
 *   607 — Ventas (e-CF emitidos y aceptados)
 *   608 — Comprobantes anulados / rechazados
 *   623 — Retenciones practicadas por el Estado a nuestras facturas
 *   IT-1 — Declaración mensual ITBIS (cuadre cobrado vs. adelantado)
 */

export interface PeriodoFiscal {
  anio: number;
  mes: number; // 1–12
}

// ─── Inputs a los generadores puros ──────────────────────────────────────────

/** Una fila del 606 = una factura de proveedor del período. */
export interface DatosFila606 {
  rncCedula: string;
  /** 1=RNC, 2=Cédula, 3=Pasaporte/extranjero */
  tipoIdentificacion: '1' | '2' | '3';
  /** B=bienes, S=servicios, BS=mixto — derivado de tipoEcf en el servicio */
  tipoBienServicio: 'B' | 'S' | 'BS';
  ncf: string;
  ncfModificado?: string;
  fechaComprobante: string; // YYYY-MM-DD
  fechaPago?: string;       // YYYY-MM-DD (si ya está pagada la CxP)
  montoSubtotal: string;    // NUMERIC string
  montoItbis: string;
  /** Retención ITBIS practicada al proveedor (calculada desde tercero.retencionItbisPct) */
  itbisRetenido: string;
  /** Retención ISR practicada al proveedor (calculada desde tercero.retencionIsrPct) */
  isrRetenido: string;
}

/** Una fila del 607 = un e-CF emitido y aceptado del período. */
export interface DatosFila607 {
  rncCedula: string;
  tipoIdentificacion: '1' | '2' | '3';
  ncf: string;
  ncfModificado?: string;
  fechaComprobante: string;
  montoSubtotal: string;
  montoItbis: string;
  /** ITBIS que el cliente (entidad estatal) nos retuvo */
  itbisRetenidoPorCliente: string;
  /** ISR que el cliente nos retuvo */
  isrRetenidoPorCliente: string;
}

/** Una fila del 608 = un comprobante anulado o rechazado del período. */
export interface DatosFila608 {
  tipoComprobante: string;
  ncf: string;
  fechaEmisionOriginal?: string;
}

/** Una fila del 623 = un e-CF de venta donde el cliente estatal retuvo impuestos. */
export interface DatosFila623 {
  rncRetenedor: string;
  nombreRetenedor: string;
  ncfDocumento: string;
  fechaDocumento: string;
  montoDocumento: string;
  itbisRetenido: string;
  isrRetenido: string;
}

/** Datos del libro mayor usados para reconciliar el IT-1 (cuenta 2102 y 1106). */
export interface DatosReconciliacionIT1 {
  /** Net CR de cuenta 2102 (ITBIS por Pagar) para el período — positivo si hay deuda */
  itbisPorPagarContable: string;
  /** Net DR de cuenta 1106 (ITBIS Adelantado) para el período — positivo si hay crédito */
  itbisAdelantadoContable: string;
}

// ─── Resultados de los reportes ───────────────────────────────────────────────

export interface Reporte606 {
  rncEmpresa: string;
  periodo: PeriodoFiscal;
  filas: DatosFila606[];
  totales: {
    facturas: number;
    montoSubtotal: string;
    montoItbis: string;
    itbisRetenido: string;
    isrRetenido: string;
  };
}

export interface Reporte607 {
  rncEmpresa: string;
  periodo: PeriodoFiscal;
  filas: DatosFila607[];
  totales: {
    comprobantes: number;
    montoSubtotal: string;
    montoItbis: string;
    itbisRetenidoPorClientes: string;
    isrRetenidoPorClientes: string;
  };
}

export interface Reporte608 {
  rncEmpresa: string;
  periodo: PeriodoFiscal;
  filas: DatosFila608[];
  totales: {
    anulados: number;
  };
}

export interface Reporte623 {
  rncEmpresa: string;
  periodo: PeriodoFiscal;
  filas: DatosFila623[];
  totales: {
    documentos: number;
    itbisRetenido: string;
    isrRetenido: string;
    totalRetenido: string;
  };
}

export interface ReporteIT1 {
  rncEmpresa: string;
  periodo: PeriodoFiscal;
  /** ITBIS cobrado en ventas (sum de comprobante_ecf E31/E32 aceptados) */
  itbisCobrado: string;
  /** ITBIS adelantado en compras (sum de factura_proveedor validadas con NCF E31/B01) */
  itbisAdelantado: string;
  /** ITBIS retenido por entidades estatales (sum de factura_cliente con cliente estatal) */
  itbisRetenidoPorEstado: string;
  /** ITBIS a pagar = cobrado − adelantado − retenidoPorEstado */
  itbisAPagar: string;
  /** Reconciliación contra el libro mayor — cuadra=true si el ledger está correcto */
  reconciliacion: {
    itbisPorPagarContable: string;
    itbisAdelantadoContable: string;
    /** diferencia = (cobrado − adelantado − retenidoPorEstado) − (contable cobrado − contable adelantado) */
    diferencia: string;
    cuadra: boolean;
  };
}
