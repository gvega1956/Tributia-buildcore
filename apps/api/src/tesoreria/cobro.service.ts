import { Injectable } from '@nestjs/common';
import { newId } from '@tributia/shared';
import { LedgerService } from '../ledger/ledger.service.js';

export interface AplicacionCobroInput {
  cuentaPorCobrarId: string;
  monto: { amount: string; currency: string };
}

export interface RegistrarCobroInput {
  empresaId: string;
  proyectoId?: string;
  centroCostoId?: string;
  cuentaBancariaId: string;
  facturaClienteId?: string;
  montoCobrado: { amount: string; currency: string };
  tasaFactura: string;
  tasaCobro: string;
  monedaBase: 'DOP' | 'USD' | 'EUR';
  aplicaciones?: AplicacionCobroInput[];
  referenciaBancaria?: string;
}

@Injectable()
export class CobroService {
  constructor(private readonly ledger: LedgerService) {}

  async registrarCobro(tenantId: string, usuarioId: string, input: RegistrarCobroInput) {
    return this.ledger.append({
      tenantId,
      empresaId: input.empresaId,
      proyectoId: input.proyectoId ?? null,
      centroCostoId: input.centroCostoId ?? null,
      tipoEvento: 'cobro_recibido',
      usuarioId,
      payload: {
        cuentaBancariaId: input.cuentaBancariaId,
        facturaClienteId: input.facturaClienteId ?? null,
        montoCobrado: input.montoCobrado,
        tasaFactura: input.tasaFactura,
        tasaCobro: input.tasaCobro,
        monedaBase: input.monedaBase,
        aplicaciones: input.aplicaciones ?? [],
        referenciaBancaria: input.referenciaBancaria ?? null,
      },
      referenciaId: null,
      referenciaTabla: null,
      idempotencyKey: newId(),
    });
  }
}
