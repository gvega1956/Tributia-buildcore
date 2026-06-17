import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq } from 'drizzle-orm';
import { zPayloadCobroRecibido } from '@tributia/ledger';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { cuentasPorCobrar } from '../../db/schema/cxc/cuenta_por_cobrar.js';
import { ReglaContableService } from '../regla-contable.service.js';
import { AsientoContableService } from '../asiento-contable.service.js';

/**
 * Handler SÍNCRONO para cobro_recibido (REQUERIDA — ADR-0005).
 *
 * En la misma transacción:
 *   1. Genera asiento de partida doble:
 *        DEBE  1101.XX  Bancos (monto cobrado)
 *        HABER 1201.XX  Cuentas por Cobrar (monto cobrado)
 *   2. Por cada entrada en aplicaciones[], incrementa monto_cobrado en la
 *      CxC correspondiente y actualiza su estado (PAGADA_PARCIAL | PAGADA_TOTAL).
 *
 * La diferencia cambiaria (si aplica) la maneja ContabilidadDiferenciaCambiariaHandler
 * que también escucha cobro_recibido y corre en el mismo ciclo síncrono.
 */
@Injectable()
export class ContabilidadCobroRecibidoHandler implements ProjectionHandler {
  readonly nombre = 'ContabilidadCobroRecibido';
  readonly tiposEvento = ['cobro_recibido'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadCobroRecibido.parse(evento.payload);

    const regla = await this.reglaService.findByTipoEvento(tx, evento.empresaId, 'cobro_recibido');
    if (!regla) {
      throw new Error(
        `Regla contable requerida para 'cobro_recibido' no encontrada en empresa ${evento.empresaId}. ` +
          `Configure la regla antes de registrar cobros.`,
      );
    }

    const monto = new Decimal(payload.montoCobrado.amount).toFixed(4);
    const moneda = payload.montoCobrado.currency;
    const config = regla.configuracion;

    const lineas = config.lineas.map(
      (lr: { cuentaCodigo: string; tipo: 'debito' | 'credito'; descripcion?: string }) => ({
        cuentaCodigo: lr.cuentaCodigo,
        tipo: lr.tipo === 'debito' ? ('debe' as const) : ('haber' as const),
        importe: monto,
        moneda,
        ...(lr.descripcion ? { descripcion: lr.descripcion } : {}),
      }),
    );

    await this.asientoService.generar(
      {
        tenantId:    evento.tenantId,
        empresaId:   evento.empresaId,
        tipo:        'automatico',
        eventoId:    evento.id,
        reglaId:     regla.id,
        fecha:       new Date(evento.ocurridoEn).toISOString().slice(0, 10),
        descripcion: `Cobro recibido — ${monto} ${moneda}`,
        lineas,
        usuarioId:   evento.createdBy,
      },
      tx,
    );

    const now = new Date();

    for (const aplicacion of payload.aplicaciones) {
      const [cxc] = await tx
        .select({
          montoOriginal: cuentasPorCobrar.montoOriginal,
          montoCobrado:  cuentasPorCobrar.montoCobrado,
        })
        .from(cuentasPorCobrar)
        .where(eq(cuentasPorCobrar.id, aplicacion.cuentaPorCobrarId));

      if (!cxc) continue;

      const nuevoMontoCobrado = new Decimal(cxc.montoCobrado).plus(aplicacion.monto.amount);
      const montoOriginal     = new Decimal(cxc.montoOriginal);
      const nuevoEstado       = nuevoMontoCobrado.gte(montoOriginal) ? 'PAGADA_TOTAL' : 'PAGADA_PARCIAL';

      await tx
        .update(cuentasPorCobrar)
        .set({
          montoCobrado: nuevoMontoCobrado.toFixed(4),
          estado:       nuevoEstado,
          updatedAt:    now,
          updatedBy:    evento.createdBy,
        })
        .where(eq(cuentasPorCobrar.id, aplicacion.cuentaPorCobrarId));
    }
  }
}
