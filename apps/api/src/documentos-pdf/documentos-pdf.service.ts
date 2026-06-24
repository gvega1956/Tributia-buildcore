import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { OrdenCompraService } from '../compras/orden-compra.service.js';
import { CubicacionService } from '../cxc/cubicacion.service.js';
import { FacturaClienteService } from '../cxc/factura-cliente.service.js';
import { empresas } from '../db/schema/core/tenant.js';
import { terceros } from '../db/schema/catalogos/tercero.js';
import { proyectos } from '../db/schema/proyectos/proyecto.js';
import { partidas } from '../db/schema/proyectos/partida.js';
import { PdfRenderService } from './pdf-render.service.js';
import type {
  EmisorPdf,
  TerceroPdf,
  LineaOcPdf,
  LineaCubicacionPdf,
} from './pdf-render.service.js';

@Injectable()
export class DocumentosPdfService {
  constructor(
    private readonly db: DbService,
    private readonly ocSvc: OrdenCompraService,
    private readonly cubicacionSvc: CubicacionService,
    private readonly facturaCliSvc: FacturaClienteService,
    private readonly render: PdfRenderService,
  ) {}

  // ── Orden de Compra ─────────────────────────────────────────────────────────

  async generarOrdenCompraPdf(tenantId: string, ocId: string): Promise<Buffer> {
    const ocConLineas = await this.ocSvc.findById(tenantId, ocId);
    const emisor = await this.getEmisor(tenantId, ocConLineas.empresaId);
    const proveedor = await this.getTercero(tenantId, ocConLineas.terceroId);

    const lineas: LineaOcPdf[] = ocConLineas.lineas.map((l) => ({
      descripcion:    l.descripcion,
      cantidad:       l.cantidad,
      unidadMedida:   l.unidadMedida,
      precioUnitario: l.precioUnitario,
      total:          l.total,
    }));

    return this.render.renderOrdenCompra({
      emisor,
      proveedor,
      numero:                 ocConLineas.numero,
      estado:                 ocConLineas.estado,
      fechaEmision:           ocConLineas.fechaEmision,
      fechaEntregaPrometida:  ocConLineas.fechaEntregaPrometida,
      condicionesPago:        ocConLineas.condicionesPago,
      moneda:                 ocConLineas.moneda,
      totalMonto:             ocConLineas.totalMonto,
      lineas,
    });
  }

  // ── Cubicación ──────────────────────────────────────────────────────────────

  async generarCubicacionPdf(tenantId: string, cubicacionId: string): Promise<Buffer> {
    const cubConLineas = await this.cubicacionSvc.findById(tenantId, cubicacionId);
    const emisor   = await this.getEmisor(tenantId, cubConLineas.empresaId);
    const proyecto = await this.getProyecto(tenantId, cubConLineas.proyectoId);
    const cliente  = await this.getTercero(tenantId, proyecto.clienteId);
    const nombresPartida = await this.getNombresPartida(
      tenantId,
      cubConLineas.lineas.map((l) => l.partidaId),
    );

    const lineas: LineaCubicacionPdf[] = cubConLineas.lineas.map((l) => ({
      partida:          nombresPartida[l.partidaId] ?? l.partidaId,
      cantidadAnterior: l.cantidadAnterior,
      cantidadPeriodo:  l.cantidadPeriodo,
      cantidadAcumulada:l.cantidadAcumulada,
      precioUnitario:   l.precioUnitario,
      monto:            l.monto,
    }));

    return this.render.renderCubicacion({
      emisor,
      cliente,
      proyectoNombre:          proyecto.nombre,
      numeroContrato:          proyecto.numeroContrato,
      numero:                  cubConLineas.numero,
      fechaCorte:              cubConLineas.fechaCorte,
      moneda:                  cubConLineas.moneda,
      montoBruto:              cubConLineas.montoBruto,
      montoRetencionGarantia:  cubConLineas.montoRetencionGarantia,
      retencionGarantiaPct:    cubConLineas.retencionGarantiaPct,
      montoFacturable:         cubConLineas.montoFacturable,
      lineas,
    });
  }

  // ── Factura Cliente ─────────────────────────────────────────────────────────

  async generarFacturaClientePdf(tenantId: string, facturaId: string): Promise<Buffer> {
    const factura  = await this.facturaCliSvc.findById(tenantId, facturaId);
    const emisor   = await this.getEmisor(tenantId, factura.empresaId);
    const cliente  = await this.getTercero(tenantId, factura.clienteId);
    const proyecto = await this.getProyecto(tenantId, factura.proyectoId);

    // Líneas vienen de la cubicación vinculada
    const cubConLineas = await this.cubicacionSvc.findById(tenantId, factura.cubicacionId);
    const nombresPartida = await this.getNombresPartida(
      tenantId,
      cubConLineas.lineas.map((l) => l.partidaId),
    );
    const lineas: LineaCubicacionPdf[] = cubConLineas.lineas.map((l) => ({
      partida:          nombresPartida[l.partidaId] ?? l.partidaId,
      cantidadAnterior: l.cantidadAnterior,
      cantidadPeriodo:  l.cantidadPeriodo,
      cantidadAcumulada:l.cantidadAcumulada,
      precioUnitario:   l.precioUnitario,
      monto:            l.monto,
    }));

    return this.render.renderFacturaCliente({
      emisor,
      cliente,
      proyectoNombre:        proyecto.nombre,
      numero:                factura.numero,
      ncf:                   factura.ncf,
      fechaEmision:          factura.fechaEmision,
      moneda:                factura.moneda,
      montoSubtotal:         factura.montoSubtotal,
      montoItbis:            factura.montoItbis,
      montoRetencionIsr:     factura.montoRetencionIsr,
      montoRetencionItbis:   factura.montoRetencionItbis,
      montoTotal:            factura.montoTotal,
      montoNetoACobrar:      factura.montoNetoACobrar,
      lineas,
    });
  }

  // ── Helpers privados ────────────────────────────────────────────────────────

  private async getEmisor(tenantId: string, empresaId: string): Promise<EmisorPdf> {
    const [emp] = await this.db.tx
      .select({ nombre: empresas.nombre, rnc: empresas.rnc })
      .from(empresas)
      .where(and(eq(empresas.id, empresaId), eq(empresas.tenantId, tenantId)))
      .limit(1);
    if (!emp) throw new NotFoundException(`Empresa ${empresaId} no encontrada`);
    return { nombre: emp.nombre, rnc: emp.rnc };
  }

  private async getTercero(tenantId: string, terceroId: string): Promise<TerceroPdf> {
    const [t] = await this.db.tx
      .select({
        nombreComercial: terceros.nombreComercial,
        rncCedula:       terceros.rncCedula,
        email:           terceros.email,
        telefono:        terceros.telefono,
        direccion:       terceros.direccion,
      })
      .from(terceros)
      .where(and(eq(terceros.id, terceroId), eq(terceros.tenantId, tenantId)))
      .limit(1);
    if (!t) throw new NotFoundException(`Tercero ${terceroId} no encontrado`);
    return t;
  }

  private async getProyecto(tenantId: string, proyectoId: string) {
    const [p] = await this.db.tx
      .select({
        nombre:         proyectos.nombre,
        clienteId:      proyectos.clienteId,
        numeroContrato: proyectos.numeroContrato,
      })
      .from(proyectos)
      .where(and(eq(proyectos.id, proyectoId), eq(proyectos.tenantId, tenantId)))
      .limit(1);
    if (!p) throw new NotFoundException(`Proyecto ${proyectoId} no encontrado`);
    return p;
  }

  private async getNombresPartida(
    tenantId: string,
    partidaIds: string[],
  ): Promise<Record<string, string>> {
    if (partidaIds.length === 0) return {};
    const rows = await this.db.tx
      .select({ id: partidas.id, nombre: partidas.nombre })
      .from(partidas)
      .where(and(eq(partidas.tenantId, tenantId), inArray(partidas.id, partidaIds)));
    return Object.fromEntries(rows.map((r) => [r.id, r.nombre]));
  }
}
