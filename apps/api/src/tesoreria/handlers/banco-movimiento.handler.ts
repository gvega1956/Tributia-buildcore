import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, sql } from 'drizzle-orm';
import {
  zPayloadCobroRecibido,
  zPayloadPagoEmitido,
  zPayloadReposicionCajaChica,
} from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { movimientosBancarios } from '../../db/schema/tesoreria/movimiento_bancario.js';
import { cuentasBancarias } from '../../db/schema/tesoreria/cuenta_bancaria.js';

/**
 * Handler SÍNCRONO: crea movimiento_bancario y actualiza saldo_actual en
 * cuenta_bancaria para los tres tipos de evento que tocan el banco.
 *
 *   cobro_recibido       → DEPOSITO (cuentaBancariaId del payload)
 *   pago_emitido         → RETIRO   (cuentaBancariaId del payload)
 *   reposicion_caja_chica → RETIRO  (cuentaBancariaOrigenId del payload)
 */
@Injectable()
export class BancoMovimientoHandler implements ProjectionHandler {
  readonly nombre = 'BancoMovimiento';
  readonly tiposEvento = ['cobro_recibido', 'pago_emitido', 'reposicion_caja_chica'] as const;
  readonly modo = 'sincrono' as const;

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const now = new Date();
    let tipo: 'DEPOSITO' | 'RETIRO';
    let cuentaBancariaId: string;
    let monto: string;
    let moneda: string;
    let concepto: string;
    let referencia: string | undefined;

    switch (evento.tipoEvento) {
      case 'cobro_recibido': {
        const p = zPayloadCobroRecibido.parse(evento.payload);
        tipo = 'DEPOSITO';
        cuentaBancariaId = p.cuentaBancariaId;
        monto = new Decimal(p.montoCobrado.amount).toFixed(4);
        moneda = p.montoCobrado.currency;
        concepto = `Cobro recibido — evento ${evento.id.slice(0, 8)}`;
        referencia = p.referenciaBancaria ?? undefined;
        break;
      }
      case 'pago_emitido': {
        const p = zPayloadPagoEmitido.parse(evento.payload);
        tipo = 'RETIRO';
        cuentaBancariaId = p.cuentaBancariaId;
        monto = new Decimal(p.monto.amount).toFixed(4);
        moneda = p.monto.currency;
        concepto = p.concepto;
        referencia = p.referenciaBancaria ?? undefined;
        break;
      }
      case 'reposicion_caja_chica': {
        const p = zPayloadReposicionCajaChica.parse(evento.payload);
        tipo = 'RETIRO';
        cuentaBancariaId = p.cuentaBancariaOrigenId;
        monto = new Decimal(p.monto.amount).toFixed(4);
        moneda = p.monto.currency;
        concepto = `Reposición caja chica — evento ${evento.id.slice(0, 8)}`;
        break;
      }
      default:
        return;
    }

    await tx.insert(movimientosBancarios).values({
      id: newId(),
      tenantId: evento.tenantId,
      empresaId: evento.empresaId,
      cuentaBancariaId,
      tipo,
      monto,
      moneda,
      fecha: new Date(evento.ocurridoEn).toISOString().slice(0, 10),
      concepto,
      referencia: referencia ?? null,
      eventoOrigenId: evento.id,
      conciliado: false,
      lineaExtractoId: null,
      createdAt: now,
      createdBy: evento.createdBy,
      updatedAt: now,
      updatedBy: evento.createdBy,
    });

    const delta = tipo === 'DEPOSITO' ? monto : `-${monto}`;

    await tx
      .update(cuentasBancarias)
      .set({
        saldoActual: sql`saldo_actual + ${delta}::numeric`,
        updatedAt: now,
        updatedBy: evento.createdBy,
      })
      .where(eq(cuentasBancarias.id, cuentaBancariaId));
  }
}
