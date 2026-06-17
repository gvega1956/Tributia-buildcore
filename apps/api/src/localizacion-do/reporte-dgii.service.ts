/**
 * ReporteDgiiService — genera los reportes 606/607/608/623/IT-1 consultando
 * directamente las tablas de negocio (sin re-digitación, §17 arquitectura.md).
 *
 * La lógica fiscal pura (generadores, totales, reconciliación) vive en
 * @tributia/localizacion-do. Este servicio aporta solo el acceso a BD.
 *
 * Fuentes:
 *   606 → factura_proveedor + tercero
 *   607 → comprobante_ecf + factura_cliente + tercero
 *   608 → comprobante_ecf WHERE estado='RECHAZADO'
 *   623 → factura_cliente + tercero WHERE es_institucion_estatal=true + comprobante_ecf
 *   IT-1 → agrega 607 (cobrado) + 606 (adelantado) + 623 (retenido) +
 *           linea_asiento WHERE cuenta 2102/1106 (reconciliación)
 */
import { Injectable, BadRequestException } from '@nestjs/common';
import { and, eq, gte, lte, isNull, inArray, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import {
  generarReporte606,
  generarReporte607,
  generarReporte608,
  generarReporte623,
  generarReporteIT1,
  exportar606Txt,
  exportar607Txt,
  exportar608Txt,
  exportar623Txt,
  type DatosFila606,
  type DatosFila607,
  type DatosFila608,
  type DatosFila623,
  type Reporte606,
  type Reporte607,
  type Reporte608,
  type Reporte623,
  type ReporteIT1,
} from '@tributia/localizacion-do';
import { DbService } from '../database/db.service.js';
import { facturasProveedor } from '../db/schema/compras/factura_proveedor.js';
import { terceros } from '../db/schema/catalogos/tercero.js';
import { comprobantesEcf } from '../db/schema/localizacion-do/comprobante_ecf.js';
import { facturasCliente } from '../db/schema/cxc/factura_cliente.js';
import { empresas } from '../db/schema/core/tenant.js';
import { lineasAsiento } from '../db/schema/contabilidad/linea_asiento.js';
import { asientosContables } from '../db/schema/contabilidad/asiento_contable.js';
import { cuentasContables } from '../db/schema/contabilidad/cuenta_contable.js';

function periodoRango(anio: number, mes: number): { inicio: string; fin: string } {
  const inicio = `${anio}-${mes.toString().padStart(2, '0')}-01`;
  const lastDay = new Date(anio, mes, 0).getDate();
  const fin = `${anio}-${mes.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;
  return { inicio, fin };
}

function tipoIdDgii(tipoId: string): '1' | '2' | '3' {
  if (tipoId === 'RNC') return '1';
  if (tipoId === 'CEDULA') return '2';
  return '3';
}

function tipoBienServicio(tipoEcf: string | null): 'B' | 'S' | 'BS' {
  if (!tipoEcf) return 'BS';
  const t = tipoEcf.toUpperCase();
  if (t === 'E41' || t === 'B11') return 'B';
  if (t === 'E31' || t === 'B01') return 'S';
  return 'BS';
}

@Injectable()
export class ReporteDgiiService {
  constructor(private readonly db: DbService) {}

  private async rncEmpresa(tenantId: string, empresaId: string): Promise<string> {
    const [emp] = await this.db.tx
      .select({ rnc: empresas.rnc })
      .from(empresas)
      .where(and(eq(empresas.id, empresaId), eq(empresas.tenantId, tenantId)))
      .limit(1);
    return emp?.rnc ?? empresaId;
  }

  // ── 606 ────────────────────────────────────────────────────────────────────

  async generar606(tenantId: string, empresaId: string, anio: number, mes: number): Promise<Reporte606> {
    this.validarPeriodo(anio, mes);
    const { inicio, fin } = periodoRango(anio, mes);
    const rnc = await this.rncEmpresa(tenantId, empresaId);

    const rows = await this.db.tx
      .select({
        ncf: facturasProveedor.ncf,
        tipoEcf: facturasProveedor.tipoEcf,
        fechaFactura: facturasProveedor.fechaFactura,
        montoSubtotal: facturasProveedor.montoSubtotal,
        montoItbis: facturasProveedor.montoItbis,
        rncCedula: terceros.rncCedula,
        tipoIdentificacion: terceros.tipoIdentificacion,
        retencionIsrPct: terceros.retencionIsrPct,
        retencionItbisPct: terceros.retencionItbisPct,
      })
      .from(facturasProveedor)
      .innerJoin(terceros, eq(facturasProveedor.terceroId, terceros.id))
      .where(
        and(
          eq(facturasProveedor.tenantId, tenantId),
          eq(facturasProveedor.empresaId, empresaId),
          isNull(facturasProveedor.deletedAt),
          gte(facturasProveedor.fechaFactura, inicio),
          lte(facturasProveedor.fechaFactura, fin),
        ),
      )
      .orderBy(facturasProveedor.fechaFactura);

    const filas: DatosFila606[] = rows.map((r) => {
      const subtotal = new Decimal(r.montoSubtotal);
      const itbis = new Decimal(r.montoItbis);
      const isrPct = r.retencionIsrPct ? new Decimal(r.retencionIsrPct).dividedBy(100) : null;
      const itbisPct = r.retencionItbisPct ? new Decimal(r.retencionItbisPct).dividedBy(100) : null;
      const isrRetenido = isrPct ? subtotal.times(isrPct).toFixed(4) : '0.0000';
      const itbisRetenido = itbisPct ? itbis.times(itbisPct).toFixed(4) : '0.0000';

      const fila: DatosFila606 = {
        rncCedula: r.rncCedula,
        tipoIdentificacion: tipoIdDgii(r.tipoIdentificacion),
        tipoBienServicio: tipoBienServicio(r.tipoEcf),
        ncf: r.ncf,
        fechaComprobante: r.fechaFactura,
        montoSubtotal: r.montoSubtotal,
        montoItbis: r.montoItbis,
        itbisRetenido,
        isrRetenido,
      };
      return fila;
    });

    return generarReporte606(rnc, { anio, mes }, filas);
  }

  exportar606Txt(reporte: Reporte606): string {
    return exportar606Txt(reporte);
  }

  // ── 607 ────────────────────────────────────────────────────────────────────

  async generar607(tenantId: string, empresaId: string, anio: number, mes: number): Promise<Reporte607> {
    this.validarPeriodo(anio, mes);
    const { inicio, fin } = periodoRango(anio, mes);
    const rnc = await this.rncEmpresa(tenantId, empresaId);

    const rows = await this.db.tx
      .select({
        ncf: comprobantesEcf.ncf,
        tipoEcf: comprobantesEcf.tipoEcf,
        fechaEmision: comprobantesEcf.fechaEmision,
        montoSubtotal: comprobantesEcf.montoSubtotal,
        montoItbis: comprobantesEcf.montoItbis,
        comprobanteOrigenId: comprobantesEcf.comprobanteOrigenId,
        documento: comprobantesEcf.documento,
        facturaClienteId: comprobantesEcf.facturaClienteId,
        montoRetencionIsr: facturasCliente.montoRetencionIsr,
        montoRetencionItbis: facturasCliente.montoRetencionItbis,
        rncCedula: terceros.rncCedula,
        tipoIdentificacion: terceros.tipoIdentificacion,
      })
      .from(comprobantesEcf)
      .leftJoin(facturasCliente, eq(comprobantesEcf.facturaClienteId, facturasCliente.id))
      .leftJoin(terceros, eq(facturasCliente.clienteId, terceros.id))
      .where(
        and(
          eq(comprobantesEcf.tenantId, tenantId),
          eq(comprobantesEcf.empresaId, empresaId),
          eq(comprobantesEcf.estado, 'ACEPTADO'),
          isNull(comprobantesEcf.deletedAt),
          gte(comprobantesEcf.fechaEmision, inicio),
          lte(comprobantesEcf.fechaEmision, fin),
        ),
      )
      .orderBy(comprobantesEcf.fechaEmision);

    const filas: DatosFila607[] = rows.map((r) => {
      // Para ajustes (33/34) sin factura_cliente, extraer receptor del JSONB
      let rncCliente = r.rncCedula ?? '';
      let tipoIdCliente: '1' | '2' | '3' = r.tipoIdentificacion ? tipoIdDgii(r.tipoIdentificacion) : '1';

      if (!r.rncCedula && r.documento) {
        const doc = r.documento as { receptor?: { rncOCedula?: string } };
        rncCliente = doc.receptor?.rncOCedula ?? '';
        tipoIdCliente = rncCliente.length === 9 ? '1' : '2';
      }

      const ncfMod = r.comprobanteOrigenId ? undefined : undefined; // populated via origen join if needed

      const fila: DatosFila607 = {
        rncCedula: rncCliente,
        tipoIdentificacion: tipoIdCliente,
        ncf: r.ncf,
        fechaComprobante: r.fechaEmision,
        montoSubtotal: r.montoSubtotal,
        montoItbis: r.montoItbis,
        itbisRetenidoPorCliente: r.montoRetencionItbis ?? '0.0000',
        isrRetenidoPorCliente: r.montoRetencionIsr ?? '0.0000',
      };
      if (ncfMod !== undefined) (fila as { ncfModificado?: string }).ncfModificado = ncfMod;
      return fila;
    });

    return generarReporte607(rnc, { anio, mes }, filas);
  }

  exportar607Txt(reporte: Reporte607): string {
    return exportar607Txt(reporte);
  }

  // ── 608 ────────────────────────────────────────────────────────────────────

  async generar608(tenantId: string, empresaId: string, anio: number, mes: number): Promise<Reporte608> {
    this.validarPeriodo(anio, mes);
    const { inicio, fin } = periodoRango(anio, mes);
    const rnc = await this.rncEmpresa(tenantId, empresaId);

    const rows = await this.db.tx
      .select({
        ncf: comprobantesEcf.ncf,
        tipoEcf: comprobantesEcf.tipoEcf,
        fechaEmision: comprobantesEcf.fechaEmision,
      })
      .from(comprobantesEcf)
      .where(
        and(
          eq(comprobantesEcf.tenantId, tenantId),
          eq(comprobantesEcf.empresaId, empresaId),
          eq(comprobantesEcf.estado, 'RECHAZADO'),
          gte(comprobantesEcf.fechaEmision, inicio),
          lte(comprobantesEcf.fechaEmision, fin),
        ),
      )
      .orderBy(comprobantesEcf.fechaEmision);

    const filas: DatosFila608[] = rows.map((r) => ({
      tipoComprobante: r.tipoEcf ?? '',
      ncf: r.ncf,
      fechaEmisionOriginal: r.fechaEmision,
    }));

    return generarReporte608(rnc, { anio, mes }, filas);
  }

  exportar608Txt(reporte: Reporte608): string {
    return exportar608Txt(reporte);
  }

  // ── 623 ────────────────────────────────────────────────────────────────────

  async generar623(tenantId: string, empresaId: string, anio: number, mes: number): Promise<Reporte623> {
    this.validarPeriodo(anio, mes);
    const { inicio, fin } = periodoRango(anio, mes);
    const rnc = await this.rncEmpresa(tenantId, empresaId);

    const rows = await this.db.tx
      .select({
        rncRetenedor: terceros.rncCedula,
        nombreRetenedor: terceros.nombreComercial,
        ncfDocumento: comprobantesEcf.ncf,
        fechaDocumento: facturasCliente.fechaEmision,
        montoDocumento: facturasCliente.montoTotal,
        itbisRetenido: facturasCliente.montoRetencionItbis,
        isrRetenido: facturasCliente.montoRetencionIsr,
      })
      .from(facturasCliente)
      .innerJoin(terceros, eq(facturasCliente.clienteId, terceros.id))
      .innerJoin(comprobantesEcf, eq(comprobantesEcf.facturaClienteId, facturasCliente.id))
      .where(
        and(
          eq(facturasCliente.tenantId, tenantId),
          eq(facturasCliente.empresaId, empresaId),
          eq(terceros.esInstitucionEstatal, true),
          isNull(facturasCliente.deletedAt),
          eq(comprobantesEcf.estado, 'ACEPTADO'),
          isNull(comprobantesEcf.deletedAt),
          gte(facturasCliente.fechaEmision, inicio),
          lte(facturasCliente.fechaEmision, fin),
          sql`(${facturasCliente.montoRetencionItbis}::numeric > 0 OR ${facturasCliente.montoRetencionIsr}::numeric > 0)`,
        ),
      )
      .orderBy(facturasCliente.fechaEmision);

    const filas: DatosFila623[] = rows.map((r) => ({
      rncRetenedor: r.rncRetenedor,
      nombreRetenedor: r.nombreRetenedor,
      ncfDocumento: r.ncfDocumento,
      fechaDocumento: r.fechaDocumento,
      montoDocumento: r.montoDocumento,
      itbisRetenido: r.itbisRetenido,
      isrRetenido: r.isrRetenido,
    }));

    return generarReporte623(rnc, { anio, mes }, filas);
  }

  exportar623Txt(reporte: Reporte623): string {
    return exportar623Txt(reporte);
  }

  // ── IT-1 ───────────────────────────────────────────────────────────────────

  async generarIT1(tenantId: string, empresaId: string, anio: number, mes: number): Promise<ReporteIT1> {
    this.validarPeriodo(anio, mes);
    const { inicio, fin } = periodoRango(anio, mes);
    const rnc = await this.rncEmpresa(tenantId, empresaId);

    // ITBIS cobrado = sum(comprobante_ecf.monto_itbis) WHERE tipo E31/E32 ACEPTADO
    const [cobradoRow] = await this.db.tx
      .select({ total: sql<string>`COALESCE(SUM(${comprobantesEcf.montoItbis}::numeric),0)` })
      .from(comprobantesEcf)
      .where(
        and(
          eq(comprobantesEcf.tenantId, tenantId),
          eq(comprobantesEcf.empresaId, empresaId),
          eq(comprobantesEcf.estado, 'ACEPTADO'),
          isNull(comprobantesEcf.deletedAt),
          inArray(comprobantesEcf.tipoEcf, ['E31', 'E32']),
          gte(comprobantesEcf.fechaEmision, inicio),
          lte(comprobantesEcf.fechaEmision, fin),
        ),
      );

    // ITBIS adelantado = sum(factura_proveedor.monto_itbis) WHERE tipoEcf E31/B01 validado
    const [adelantadoRow] = await this.db.tx
      .select({ total: sql<string>`COALESCE(SUM(${facturasProveedor.montoItbis}::numeric),0)` })
      .from(facturasProveedor)
      .where(
        and(
          eq(facturasProveedor.tenantId, tenantId),
          eq(facturasProveedor.empresaId, empresaId),
          eq(facturasProveedor.ecfValidado, true),
          isNull(facturasProveedor.deletedAt),
          inArray(facturasProveedor.tipoEcf, ['E31', 'B01']),
          gte(facturasProveedor.fechaFactura, inicio),
          lte(facturasProveedor.fechaFactura, fin),
        ),
      );

    // ITBIS retenido por Estado = sum(factura_cliente.monto_retencion_itbis) WHERE cliente estatal
    const [retenidoRow] = await this.db.tx
      .select({ total: sql<string>`COALESCE(SUM(${facturasCliente.montoRetencionItbis}::numeric),0)` })
      .from(facturasCliente)
      .innerJoin(terceros, eq(facturasCliente.clienteId, terceros.id))
      .where(
        and(
          eq(facturasCliente.tenantId, tenantId),
          eq(facturasCliente.empresaId, empresaId),
          eq(terceros.esInstitucionEstatal, true),
          isNull(facturasCliente.deletedAt),
          gte(facturasCliente.fechaEmision, inicio),
          lte(facturasCliente.fechaEmision, fin),
        ),
      );

    // Reconciliación: net CR de cuenta 2102 (ITBIS por pagar)
    const [rec2102] = await this.db.tx
      .select({
        netCr: sql<string>`
          COALESCE(SUM(CASE WHEN ${lineasAsiento.tipo} = 'haber'
            THEN ${lineasAsiento.importe}::numeric
            ELSE -(${lineasAsiento.importe}::numeric) END), 0)
        `,
      })
      .from(lineasAsiento)
      .innerJoin(asientosContables, eq(lineasAsiento.asientoId, asientosContables.id))
      .innerJoin(cuentasContables, eq(lineasAsiento.cuentaId, cuentasContables.id))
      .where(
        and(
          eq(lineasAsiento.tenantId, tenantId),
          eq(cuentasContables.empresaId, empresaId),
          sql`${cuentasContables.codigo} LIKE '2102%'`,
          eq(asientosContables.estado, 'confirmado'),
          gte(asientosContables.fecha, inicio),
          lte(asientosContables.fecha, fin),
        ),
      );

    // Reconciliación: net DR de cuenta 1106 (ITBIS adelantado)
    const [rec1106] = await this.db.tx
      .select({
        netDr: sql<string>`
          COALESCE(SUM(CASE WHEN ${lineasAsiento.tipo} = 'debe'
            THEN ${lineasAsiento.importe}::numeric
            ELSE -(${lineasAsiento.importe}::numeric) END), 0)
        `,
      })
      .from(lineasAsiento)
      .innerJoin(asientosContables, eq(lineasAsiento.asientoId, asientosContables.id))
      .innerJoin(cuentasContables, eq(lineasAsiento.cuentaId, cuentasContables.id))
      .where(
        and(
          eq(lineasAsiento.tenantId, tenantId),
          eq(cuentasContables.empresaId, empresaId),
          sql`${cuentasContables.codigo} LIKE '1106%'`,
          eq(asientosContables.estado, 'confirmado'),
          gte(asientosContables.fecha, inicio),
          lte(asientosContables.fecha, fin),
        ),
      );

    return generarReporteIT1(
      rnc,
      { anio, mes },
      cobradoRow?.total ?? '0',
      adelantadoRow?.total ?? '0',
      retenidoRow?.total ?? '0',
      {
        itbisPorPagarContable: rec2102?.netCr ?? '0',
        itbisAdelantadoContable: rec1106?.netDr ?? '0',
      },
    );
  }

  private validarPeriodo(anio: number, mes: number): void {
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2099) {
      throw new BadRequestException(`Año inválido: ${anio}`);
    }
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException(`Mes inválido: ${mes}`);
    }
  }
}
