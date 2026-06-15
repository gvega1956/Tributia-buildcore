import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { anticiposProveedor } from '../db/schema/compras/anticipo_proveedor.js';
import { cuentasPorPagar } from '../db/schema/compras/cuenta_por_pagar.js';

const zUUID = z.string().uuid();
const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const zAnticipoCreate = z.object({
  empresaId: zUUID,
  terceroId: zUUID,
  ordenCompraId: zUUID.nullable().optional(),
  numero: z.string().min(1).max(30),
  montoAnticipo: zDecimal,
  moneda: z.enum(['DOP', 'USD', 'EUR']).default('DOP'),
  fechaPago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type AnticipoCreateDto = z.infer<typeof zAnticipoCreate>;

@Injectable()
export class AnticipoProveedorService {
  constructor(private readonly db: DbService) {}

  async registrar(tenantId: string, dto: AnticipoCreateDto, usuarioId: string) {
    const anticipoId = newId();
    const now = new Date();

    await this.db.tx.insert(anticiposProveedor).values({
      id: anticipoId,
      tenantId,
      empresaId: dto.empresaId,
      terceroId: dto.terceroId,
      ordenCompraId: dto.ordenCompraId ?? null,
      numero: dto.numero,
      montoAnticipo: dto.montoAnticipo,
      montoAmortizado: '0.0000',
      moneda: dto.moneda,
      fechaPago: dto.fechaPago,
      estado: 'PENDIENTE',
      cuentaPorPagarAplicadaId: null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    });

    return { id: anticipoId, estado: 'PENDIENTE' };
  }

  async amortizar(
    tenantId: string,
    anticipoId: string,
    cxpId: string,
    monto: string,
    usuarioId: string,
  ) {
    const [anticipo] = await this.db.tx
      .select()
      .from(anticiposProveedor)
      .where(
        and(
          eq(anticiposProveedor.id, anticipoId),
          eq(anticiposProveedor.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!anticipo) throw new NotFoundException(`Anticipo ${anticipoId} no encontrado`);
    if (anticipo.estado === 'AMORTIZADO_TOTAL' || anticipo.estado === 'ANULADO') {
      throw new BadRequestException(`Anticipo en estado ${anticipo.estado} no admite amortización`);
    }

    const [cxp] = await this.db.tx
      .select()
      .from(cuentasPorPagar)
      .where(and(eq(cuentasPorPagar.id, cxpId), eq(cuentasPorPagar.tenantId, tenantId)))
      .limit(1);

    if (!cxp) throw new NotFoundException(`CxP ${cxpId} no encontrada`);

    const montoDecimal = new Decimal(monto);
    const disponible = new Decimal(anticipo.montoAnticipo).minus(anticipo.montoAmortizado);

    if (montoDecimal.gt(disponible)) {
      throw new BadRequestException(
        `El monto a amortizar ${monto} excede el disponible del anticipo (${disponible.toFixed(4)})`,
      );
    }

    const nuevoAmortizado = new Decimal(anticipo.montoAmortizado).plus(montoDecimal);
    const totalAnticipo = new Decimal(anticipo.montoAnticipo);
    const nuevoEstado = nuevoAmortizado.gte(totalAnticipo)
      ? 'AMORTIZADO_TOTAL'
      : 'AMORTIZADO_PARCIAL';

    await this.db.tx
      .update(anticiposProveedor)
      .set({
        montoAmortizado: nuevoAmortizado.toFixed(4),
        estado: nuevoEstado,
        cuentaPorPagarAplicadaId: cxpId,
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(anticiposProveedor.id, anticipoId));

    // Registrar el pago en la CxP (el anticipo reduce la deuda)
    const montoCxpPagado = new Decimal(cxp.montoPagado).plus(montoDecimal);
    const montoOriginalCxp = new Decimal(cxp.montoOriginal);
    const nuevoCxpEstado = montoCxpPagado.gte(montoOriginalCxp) ? 'PAGADA_TOTAL' : 'PAGADA_PARCIAL';

    await this.db.tx
      .update(cuentasPorPagar)
      .set({
        montoPagado: montoCxpPagado.toFixed(4),
        estado: nuevoCxpEstado,
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(cuentasPorPagar.id, cxpId));

    return {
      anticipoId,
      montoAmortizado: nuevoAmortizado.toFixed(4),
      estadoAnticipo: nuevoEstado,
      cxpId,
      montoCxpPagado: montoCxpPagado.toFixed(4),
      estadoCxp: nuevoCxpEstado,
    };
  }
}
