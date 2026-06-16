import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { terceros } from '../db/schema/catalogos/tercero.js';
import { tiposRetencion } from '../db/schema/catalogos/tipo_retencion.js';
import type { DbTx } from '../ledger/projection.types.js';

// Códigos del catálogo DGII (tipo_retencion) aplicables a facturación de obra
// a instituciones del Estado dominicano — ver seed-catalogos-dgii.ts.
const CODIGO_ISR_ESTADO = 'ISR_ESTADO_5PCT';
const CODIGO_ITBIS_ESTADO = 'ITBIS_SERVICIOS_GOB_100';

export interface RetencionClienteResult {
  esInstitucionEstatal: boolean;
  retencionIsrPct: Decimal;
  retencionItbisPct: Decimal;
  retencionIsr: Decimal;
  retencionItbis: Decimal;
}

/**
 * RetencionClienteService — calcula las retenciones que el CLIENTE aplica
 * sobre nuestra factura, según el tipo de tercero (§16).
 *
 * Si el cliente es una institución del Estado: 5% de ISR sobre el subtotal
 * y retención de ITBIS según el catálogo `tipo_retencion` (Capa 0) — nunca
 * un porcentaje hardcodeado fuera del catálogo. El override por tercero
 * (`tercero.retencionIsrPct`/`retencionItbisPct`) tiene prioridad si está
 * definido (contratos con condiciones especiales).
 *
 * Clientes privados: sin retención (no solicitada en esta sesión).
 */
@Injectable()
export class RetencionClienteService {
  async calcular(
    tx: DbTx,
    tenantId: string,
    clienteId: string,
    montoSubtotal: Decimal,
    montoItbis: Decimal,
  ): Promise<RetencionClienteResult> {
    const [cliente] = await tx
      .select()
      .from(terceros)
      .where(and(eq(terceros.id, clienteId), eq(terceros.tenantId, tenantId)))
      .limit(1);

    if (!cliente) throw new NotFoundException(`Tercero ${clienteId} no encontrado`);

    if (!cliente.esInstitucionEstatal) {
      return {
        esInstitucionEstatal: false,
        retencionIsrPct: new Decimal(0),
        retencionItbisPct: new Decimal(0),
        retencionIsr: new Decimal(0),
        retencionItbis: new Decimal(0),
      };
    }

    const isrPct = cliente.retencionIsrPct
      ? new Decimal(cliente.retencionIsrPct)
      : await this.pctVigente(tx, CODIGO_ISR_ESTADO);

    const itbisPct = cliente.retencionItbisPct
      ? new Decimal(cliente.retencionItbisPct)
      : await this.pctVigente(tx, CODIGO_ITBIS_ESTADO);

    return {
      esInstitucionEstatal: true,
      retencionIsrPct: isrPct,
      retencionItbisPct: itbisPct,
      retencionIsr: montoSubtotal.mul(isrPct).div(100),
      retencionItbis: montoItbis.mul(itbisPct).div(100),
    };
  }

  private async pctVigente(tx: DbTx, codigo: string): Promise<Decimal> {
    const [tipo] = await tx
      .select()
      .from(tiposRetencion)
      .where(and(eq(tiposRetencion.codigo, codigo), eq(tiposRetencion.activo, true)))
      .limit(1);

    if (!tipo) {
      throw new NotFoundException(
        `Catálogo de retención '${codigo}' no encontrado o inactivo — seed-catalogos-dgii.ts`,
      );
    }

    return new Decimal(tipo.porcentaje);
  }
}
