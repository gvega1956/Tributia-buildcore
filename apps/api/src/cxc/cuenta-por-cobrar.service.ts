import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, ne } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { DbService } from '../database/db.service.js';
import { cuentasPorCobrar } from '../db/schema/cxc/cuenta_por_cobrar.js';

@Injectable()
export class CuentaPorCobrarService {
  constructor(private readonly db: DbService) {}

  async listar(tenantId: string, terceroId?: string, proyectoId?: string) {
    const conditions = [eq(cuentasPorCobrar.tenantId, tenantId)];
    if (terceroId) conditions.push(eq(cuentasPorCobrar.terceroId, terceroId));
    if (proyectoId) conditions.push(eq(cuentasPorCobrar.proyectoId, proyectoId));

    return this.db.tx
      .select()
      .from(cuentasPorCobrar)
      .where(and(...conditions));
  }

  async findById(tenantId: string, id: string) {
    const [cxc] = await this.db.tx
      .select()
      .from(cuentasPorCobrar)
      .where(and(eq(cuentasPorCobrar.id, id), eq(cuentasPorCobrar.tenantId, tenantId)))
      .limit(1);

    if (!cxc) throw new NotFoundException(`CxC ${id} no encontrada`);
    return cxc;
  }

  async registrarCobro(tenantId: string, cxcId: string, monto: string, usuarioId: string) {
    const [cxc] = await this.db.tx
      .select()
      .from(cuentasPorCobrar)
      .where(and(eq(cuentasPorCobrar.id, cxcId), eq(cuentasPorCobrar.tenantId, tenantId)))
      .limit(1);

    if (!cxc) throw new NotFoundException(`CxC ${cxcId} no encontrada`);
    if (cxc.estado === 'PAGADA_TOTAL' || cxc.estado === 'ANULADA') {
      throw new BadRequestException(`CxC en estado ${cxc.estado} no admite más cobros`);
    }

    const montoCobrado = new Decimal(cxc.montoCobrado).plus(new Decimal(monto));
    const montoOriginal = new Decimal(cxc.montoOriginal);

    if (montoCobrado.gt(montoOriginal)) {
      throw new BadRequestException(
        `El cobro ${monto} excede el saldo pendiente de la CxC (${montoOriginal.minus(new Decimal(cxc.montoCobrado)).toFixed(4)})`,
      );
    }

    const nuevoEstado = montoCobrado.gte(montoOriginal) ? 'PAGADA_TOTAL' : 'PAGADA_PARCIAL';

    await this.db.tx
      .update(cuentasPorCobrar)
      .set({
        montoCobrado: montoCobrado.toFixed(4),
        estado: nuevoEstado,
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(cuentasPorCobrar.id, cxcId));

    return { id: cxcId, montoCobrado: montoCobrado.toFixed(4), estado: nuevoEstado };
  }

  /** Filtro de saldos pendientes — base compartida del aging. */
  pendientes(tenantId: string) {
    return and(eq(cuentasPorCobrar.tenantId, tenantId), ne(cuentasPorCobrar.estado, 'ANULADA'));
  }
}
