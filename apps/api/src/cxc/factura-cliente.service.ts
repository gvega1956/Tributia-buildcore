import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { RetencionClienteService } from './retencion-cliente.service.js';
import { facturasCliente } from '../db/schema/cxc/factura_cliente.js';
import { cubicaciones } from '../db/schema/cxc/cubicacion.js';

const zUUID = z.string().uuid();

export const zFacturaClienteCreateDto = z.object({
  cubicacionId: zUUID,
  clienteId: zUUID,
  numero: z.string().min(1).max(30),
  ncf: z.string().min(11).max(19).optional(),
  itbisPct: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .default('18'),
  diasCredito: z.number().int().min(0).max(365).default(30),
});

export type FacturaClienteCreateDto = z.infer<typeof zFacturaClienteCreateDto>;

/**
 * FacturaClienteService — emite la factura al cliente desde una cubicación
 * EMITIDA (§16). El monto facturable de la cubicación es el subtotal; el
 * ITBIS se calcula sobre ese subtotal; las retenciones del cliente se
 * calculan por RetencionClienteService según tipo de tercero.
 *
 * El asiento contable y la cuenta_por_cobrar nacen del handler síncrono
 * del evento emision_factura_cliente — esta clase nunca los toca directamente.
 */
@Injectable()
export class FacturaClienteService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly retencionService: RetencionClienteService,
  ) {}

  async emitir(tenantId: string, dto: FacturaClienteCreateDto, usuarioId: string) {
    const [cubicacion] = await this.db.tx
      .select()
      .from(cubicaciones)
      .where(and(eq(cubicaciones.id, dto.cubicacionId), eq(cubicaciones.tenantId, tenantId)))
      .limit(1);

    if (!cubicacion) throw new NotFoundException(`Cubicación ${dto.cubicacionId} no encontrada`);
    if (cubicacion.estado !== 'EMITIDA') {
      throw new BadRequestException(`Cubicación en estado ${cubicacion.estado} no puede facturarse`);
    }
    if (cubicacion.facturaClienteId) {
      throw new BadRequestException('Esta cubicación ya fue facturada');
    }

    const montoSubtotal = new Decimal(cubicacion.montoFacturable);
    const itbisPct = new Decimal(dto.itbisPct);
    const montoItbis = montoSubtotal.mul(itbisPct).div(100);

    const retenciones = await this.retencionService.calcular(
      this.db.tx,
      tenantId,
      dto.clienteId,
      montoSubtotal,
      montoItbis,
    );

    const montoTotal = montoSubtotal.plus(montoItbis);
    const montoNetoACobrar = montoTotal.minus(retenciones.retencionIsr).minus(retenciones.retencionItbis);

    const now = new Date();
    const fechaEmision = now.toISOString().slice(0, 10);
    const vencimiento = new Date(now);
    vencimiento.setDate(vencimiento.getDate() + dto.diasCredito);
    const fechaVencimiento = vencimiento.toISOString().slice(0, 10);
    const facturaId = newId();

    await this.db.tx.insert(facturasCliente).values({
      id: facturaId,
      tenantId,
      empresaId: cubicacion.empresaId,
      proyectoId: cubicacion.proyectoId,
      clienteId: dto.clienteId,
      cubicacionId: dto.cubicacionId,
      numero: dto.numero,
      ncf: dto.ncf?.trim().toUpperCase() ?? null,
      fechaEmision,
      montoSubtotal: montoSubtotal.toFixed(4),
      montoItbis: montoItbis.toFixed(4),
      montoRetencionIsr: retenciones.retencionIsr.toFixed(4),
      montoRetencionItbis: retenciones.retencionItbis.toFixed(4),
      montoTotal: montoTotal.toFixed(4),
      montoNetoACobrar: montoNetoACobrar.toFixed(4),
      moneda: cubicacion.moneda,
      estado: 'EMITIDA',
      eventoId: null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    });

    const evento = await this.ledger.append({
      tenantId,
      empresaId: cubicacion.empresaId,
      proyectoId: cubicacion.proyectoId,
      centroCostoId: null,
      tipoEvento: 'emision_factura_cliente',
      usuarioId,
      payload: {
        facturaClienteId: facturaId,
        cubicacionId: dto.cubicacionId,
        clienteId: dto.clienteId,
        fechaEmision,
        fechaVencimiento,
        montoSubtotal: { amount: montoSubtotal.toFixed(4), currency: cubicacion.moneda },
        montoItbis: { amount: montoItbis.toFixed(4), currency: cubicacion.moneda },
        montoRetencionIsr: { amount: retenciones.retencionIsr.toFixed(4), currency: cubicacion.moneda },
        montoRetencionItbis: { amount: retenciones.retencionItbis.toFixed(4), currency: cubicacion.moneda },
        montoTotal: { amount: montoTotal.toFixed(4), currency: cubicacion.moneda },
        montoNetoACobrar: { amount: montoNetoACobrar.toFixed(4), currency: cubicacion.moneda },
      },
      referenciaId: facturaId,
      referenciaTabla: 'factura_cliente',
      idempotencyKey: `emision_factura_cliente:${facturaId}`,
    });

    await this.db.tx
      .update(facturasCliente)
      .set({ eventoId: evento.id, updatedAt: new Date(), updatedBy: usuarioId })
      .where(eq(facturasCliente.id, facturaId));

    await this.db.tx
      .update(cubicaciones)
      .set({ facturaClienteId: facturaId, updatedAt: new Date(), updatedBy: usuarioId })
      .where(eq(cubicaciones.id, dto.cubicacionId));

    return {
      id: facturaId,
      eventoId: evento.id,
      montoSubtotal: montoSubtotal.toFixed(4),
      montoItbis: montoItbis.toFixed(4),
      montoRetencionIsr: retenciones.retencionIsr.toFixed(4),
      montoRetencionItbis: retenciones.retencionItbis.toFixed(4),
      montoTotal: montoTotal.toFixed(4),
      montoNetoACobrar: montoNetoACobrar.toFixed(4),
    };
  }

  async findAll(tenantId: string, proyectoId?: string) {
    const conditions = [eq(facturasCliente.tenantId, tenantId), isNull(facturasCliente.deletedAt)];
    if (proyectoId) conditions.push(eq(facturasCliente.proyectoId, proyectoId));

    return this.db.tx
      .select()
      .from(facturasCliente)
      .where(and(...conditions));
  }

  async findById(tenantId: string, id: string) {
    const [factura] = await this.db.tx
      .select()
      .from(facturasCliente)
      .where(and(eq(facturasCliente.id, id), eq(facturasCliente.tenantId, tenantId)))
      .limit(1);
    if (!factura) throw new NotFoundException(`Factura cliente ${id} no encontrada`);
    return factura;
  }
}
