import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and, asc } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { programacionesPago } from '../db/schema/tesoreria/programacion_pago.js';
import { cuentasBancarias } from '../db/schema/tesoreria/cuenta_bancaria.js';

export interface ProgramarPagoInput {
  empresaId: string;
  cuentaPorPagarId: string;
  cuentaBancariaId: string;
  monto: string;
  moneda?: string | undefined;
  fechaProgramada: string;
  prioridad?: number | undefined;
  proyectoId?: string | undefined;
  centroCostoId?: string | undefined;
}

@Injectable()
export class ProgramacionPagoService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  async programar(tenantId: string, usuarioId: string, input: ProgramarPagoInput) {
    if (!input.proyectoId && !input.centroCostoId) {
      throw new BadRequestException('Se requiere proyectoId o centroCostoId para imputar el pago (P3).');
    }

    const now = new Date();
    const [prog] = await this.db.tx
      .insert(programacionesPago)
      .values({
        id: newId(),
        tenantId,
        empresaId: input.empresaId,
        cuentaPorPagarId: input.cuentaPorPagarId,
        cuentaBancariaId: input.cuentaBancariaId,
        proyectoId: input.proyectoId ?? null,
        centroCostoId: input.centroCostoId ?? null,
        monto: new Decimal(input.monto).toFixed(4),
        moneda: input.moneda ?? 'DOP',
        fechaProgramada: input.fechaProgramada,
        prioridad: input.prioridad ?? 100,
        estado: 'PROGRAMADO',
        motivoEspera: null,
        eventoOrigenId: null,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();

    return prog!;
  }

  /**
   * Procesa la cola de pagos de una cuenta bancaria por orden de prioridad.
   *
   * Para cada programacion en estado PROGRAMADO (orden ascendente por prioridad):
   *   - Si saldo_actual >= monto → emite pago_emitido, marca EMITIDO
   *   - Si no alcanza → marca EN_ESPERA con motivo; sigue con el resto
   *
   * Este comportamiento es intencional: los pagos de menor prioridad pueden
   * ejecutarse si el banco tiene fondos aunque uno de mayor prioridad quede
   * en espera — salvo que el operador quiera un modo estricto.
   */
  async ejecutarLote(
    tenantId: string,
    usuarioId: string,
    cuentaBancariaId: string,
  ) {
    const [cuenta] = await this.db.tx
      .select()
      .from(cuentasBancarias)
      .where(
        and(
          eq(cuentasBancarias.id, cuentaBancariaId),
          eq(cuentasBancarias.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!cuenta) throw new NotFoundException(`Cuenta bancaria ${cuentaBancariaId} no encontrada.`);

    const pendientes = await this.db.tx
      .select()
      .from(programacionesPago)
      .where(
        and(
          eq(programacionesPago.tenantId, tenantId),
          eq(programacionesPago.cuentaBancariaId, cuentaBancariaId),
          eq(programacionesPago.estado, 'PROGRAMADO'),
        ),
      )
      .orderBy(asc(programacionesPago.prioridad));

    let saldoDisponible = new Decimal(cuenta.saldoActual);
    const resultados: { id: string; estado: string }[] = [];
    const now = new Date();

    for (const prog of pendientes) {
      const montoPago = new Decimal(prog.monto);

      if (saldoDisponible.gte(montoPago)) {
        const evento = await this.ledger.append({
          tenantId,
          empresaId: prog.empresaId,
          proyectoId: prog.proyectoId ?? null,
          centroCostoId: prog.centroCostoId ?? null,
          tipoEvento: 'pago_emitido',
          usuarioId,
          payload: {
            cuentaBancariaId,
            monto: { amount: montoPago.toFixed(4), currency: prog.moneda },
            concepto: `Pago CxP ${prog.cuentaPorPagarId.slice(0, 8)} — prog ${prog.id.slice(0, 8)}`,
            cuentasPorPagarIds: [prog.cuentaPorPagarId],
            referenciaBancaria: null,
          },
          referenciaId: prog.id,
          referenciaTabla: 'programacion_pago',
          idempotencyKey: `pago-prog-${prog.id}`,
        });

        await this.db.tx
          .update(programacionesPago)
          .set({ estado: 'EMITIDO', eventoOrigenId: evento.id, updatedAt: now, updatedBy: usuarioId })
          .where(eq(programacionesPago.id, prog.id));

        saldoDisponible = saldoDisponible.minus(montoPago);
        resultados.push({ id: prog.id, estado: 'EMITIDO' });
      } else {
        await this.db.tx
          .update(programacionesPago)
          .set({
            estado: 'EN_ESPERA',
            motivoEspera: `Saldo insuficiente en cuenta bancaria. Disponible: ${saldoDisponible.toFixed(4)} ${prog.moneda}.`,
            updatedAt: now,
            updatedBy: usuarioId,
          })
          .where(eq(programacionesPago.id, prog.id));

        resultados.push({ id: prog.id, estado: 'EN_ESPERA' });
      }
    }

    return resultados;
  }
}
