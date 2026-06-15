import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { DbService } from '../database/db.service.js';
import { cuentasPorPagar } from '../db/schema/compras/cuenta_por_pagar.js';

@Injectable()
export class CuentaPorPagarService {
  constructor(private readonly db: DbService) {}

  async listar(tenantId: string, terceroId?: string) {
    return this.db.tx
      .select()
      .from(cuentasPorPagar)
      .where(
        and(
          eq(cuentasPorPagar.tenantId, tenantId),
          terceroId ? eq(cuentasPorPagar.terceroId, terceroId) : undefined,
        ),
      );
  }

  async findById(tenantId: string, id: string) {
    const [cxp] = await this.db.tx
      .select()
      .from(cuentasPorPagar)
      .where(and(eq(cuentasPorPagar.id, id), eq(cuentasPorPagar.tenantId, tenantId)))
      .limit(1);

    if (!cxp) throw new NotFoundException(`CxP ${id} no encontrada`);
    return cxp;
  }

  async registrarPago(
    tenantId: string,
    cxpId: string,
    monto: string,
    usuarioId: string,
  ) {
    const [cxp] = await this.db.tx
      .select()
      .from(cuentasPorPagar)
      .where(and(eq(cuentasPorPagar.id, cxpId), eq(cuentasPorPagar.tenantId, tenantId)))
      .limit(1);

    if (!cxp) throw new NotFoundException(`CxP ${cxpId} no encontrada`);
    if (cxp.estado === 'PAGADA_TOTAL' || cxp.estado === 'ANULADA') {
      throw new BadRequestException(`CxP en estado ${cxp.estado} no admite más pagos`);
    }

    const montoPagado = new Decimal(cxp.montoPagado).plus(new Decimal(monto));
    const montoOriginal = new Decimal(cxp.montoOriginal);

    if (montoPagado.gt(montoOriginal)) {
      throw new BadRequestException(
        `El pago ${monto} excede el saldo pendiente de la CxP (${montoOriginal.minus(new Decimal(cxp.montoPagado)).toFixed(4)})`,
      );
    }

    const nuevoEstado =
      montoPagado.gte(montoOriginal) ? 'PAGADA_TOTAL' : 'PAGADA_PARCIAL';

    await this.db.tx
      .update(cuentasPorPagar)
      .set({
        montoPagado: montoPagado.toFixed(4),
        estado: nuevoEstado,
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(cuentasPorPagar.id, cxpId));

    return { id: cxpId, montoPagado: montoPagado.toFixed(4), estado: nuevoEstado };
  }
}
