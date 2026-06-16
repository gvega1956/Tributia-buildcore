import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { DbService } from '../database/db.service.js';
import { cuentasPorCobrar } from '../db/schema/cxc/cuenta_por_cobrar.js';

export const TRAMOS_AGING = ['CORRIENTE', '1-30', '31-60', '61-90', '90+'] as const;
export type TramoAging = (typeof TRAMOS_AGING)[number];

export interface AgingGrupo {
  clave: string;
  saldoPendiente: string;
  tramos: Record<TramoAging, string>;
}

function clasificarTramo(diasVencido: number): TramoAging {
  if (diasVencido <= 0) return 'CORRIENTE';
  if (diasVencido <= 30) return '1-30';
  if (diasVencido <= 60) return '31-60';
  if (diasVencido <= 90) return '61-90';
  return '90+';
}

/**
 * AgingService — antigüedad de saldos de CxC (§16), agrupado por cliente
 * y por proyecto. Tramos vencidos se calculan contra fechaVencimiento
 * (fecha_emision + diasCredito); si no hay vencimiento registrado se usa
 * fecha_emision como referencia (CxC sin plazo explícito = vence al emitirse).
 */
@Injectable()
export class AgingService {
  constructor(private readonly db: DbService) {}

  async porCliente(tenantId: string, asOf: Date = new Date()): Promise<AgingGrupo[]> {
    const rows = await this.cargarPendientes(tenantId);
    return this.agrupar(rows, asOf, (r) => r.terceroId);
  }

  async porProyecto(tenantId: string, asOf: Date = new Date()): Promise<AgingGrupo[]> {
    const rows = await this.cargarPendientes(tenantId);
    return this.agrupar(rows, asOf, (r) => r.proyectoId);
  }

  private async cargarPendientes(tenantId: string) {
    const rows = await this.db.tx
      .select()
      .from(cuentasPorCobrar)
      .where(and(eq(cuentasPorCobrar.tenantId, tenantId), ne(cuentasPorCobrar.estado, 'ANULADA')));

    return rows.filter((r) => new Decimal(r.montoOriginal).minus(r.montoCobrado).gt(0));
  }

  private agrupar(
    rows: (typeof cuentasPorCobrar.$inferSelect)[],
    asOf: Date,
    keyOf: (r: typeof cuentasPorCobrar.$inferSelect) => string,
  ): AgingGrupo[] {
    const grupos = new Map<string, AgingGrupo>();

    for (const row of rows) {
      const clave = keyOf(row);
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          clave,
          saldoPendiente: '0.0000',
          tramos: { CORRIENTE: '0.0000', '1-30': '0.0000', '31-60': '0.0000', '61-90': '0.0000', '90+': '0.0000' },
        });
      }
      const grupo = grupos.get(clave)!;

      const saldo = new Decimal(row.montoOriginal).minus(row.montoCobrado);
      const fechaReferencia = row.fechaVencimiento ?? row.fechaEmision;
      const diasVencido = Math.floor(
        (asOf.getTime() - new Date(fechaReferencia).getTime()) / (1000 * 60 * 60 * 24),
      );
      const tramo = clasificarTramo(diasVencido);

      grupo.saldoPendiente = new Decimal(grupo.saldoPendiente).plus(saldo).toFixed(4);
      grupo.tramos[tramo] = new Decimal(grupo.tramos[tramo]).plus(saldo).toFixed(4);
    }

    return Array.from(grupos.values());
  }
}
