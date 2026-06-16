import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { zPayloadHoraPersonal } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ejecucionPartidas } from '../../db/schema/compras/ejecucion_partida.js';
import { ReglaContableService } from '../../contabilidad/regla-contable.service.js';
import { AsientoContableService } from '../../contabilidad/asiento-contable.service.js';

/**
 * Handler SÍNCRONO para el evento hora_personal.
 *
 * Consecuencias en la misma transacción:
 *   1. Incrementa ejecucion_partida.devengado en costoTotal (horas * tarifa)
 *   2. Genera asiento contable (DEBE: Costo MO en Obra / HABER: MO por Pagar)
 *      si existe regla contable configurada para hora_personal.
 */
@Injectable()
export class ObraHoraPersonalHandler implements ProjectionHandler {
  readonly nombre = 'ObraHoraPersonal';
  readonly tiposEvento = ['hora_personal'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadHoraPersonal.parse(evento.payload);
    const now = new Date();
    const costoTotal = new Decimal(payload.costoTotal);

    // ── 1. Incrementar devengado en ejecucion_partida ─────────────────────────
    const [existente] = await tx
      .select()
      .from(ejecucionPartidas)
      .where(
        and(
          eq(ejecucionPartidas.tenantId, evento.tenantId),
          eq(ejecucionPartidas.partidaId, payload.partidaId),
        ),
      )
      .limit(1);

    if (existente) {
      const nuevoDevengado = new Decimal(existente.devengado).plus(costoTotal);

      await tx
        .update(ejecucionPartidas)
        .set({
          devengado: nuevoDevengado.toFixed(4),
          ultimaActualizacion: now,
          updatedAt: now,
          updatedBy: evento.createdBy,
        })
        .where(eq(ejecucionPartidas.id, existente.id));
    } else {
      await tx.insert(ejecucionPartidas).values({
        id: newId(),
        tenantId: evento.tenantId,
        partidaId: payload.partidaId,
        comprometido: '0.0000',
        devengado: costoTotal.toFixed(4),
        avanceCantidad: '0.0000',
        moneda: payload.moneda,
        ultimaActualizacion: now,
        createdAt: now,
        createdBy: evento.createdBy,
        updatedAt: now,
        updatedBy: evento.createdBy,
      });
    }

    // ── 2. Generar asiento contable si hay regla configurada ─────────────────
    const regla = await this.reglaService.findByTipoEvento(tx, evento.empresaId, 'hora_personal');

    if (regla) {
      const config = regla.configuracion;
      const lineas = config.lineas.map(
        (lr: { cuentaCodigo: string; tipo: 'debito' | 'credito'; descripcion?: string }) => ({
          cuentaCodigo: lr.cuentaCodigo,
          tipo: lr.tipo === 'debito' ? ('debe' as const) : ('haber' as const),
          importe: costoTotal.toFixed(4),
          moneda: payload.moneda,
          ...(lr.descripcion ? { descripcion: lr.descripcion } : {}),
        }),
      );

      await this.asientoService.generar(
        {
          tenantId: evento.tenantId,
          empresaId: evento.empresaId,
          tipo: 'automatico',
          eventoId: evento.id,
          reglaId: regla.id,
          fecha: new Date(evento.ocurridoEn).toISOString().slice(0, 10),
          descripcion: `MO ${payload.nombre} — ${payload.horasTrabajadas}h × ${payload.tarifaHoraria} ${payload.moneda}`,
          lineas,
          usuarioId: evento.createdBy,
        },
        tx,
      );
    } else {
      throw new Error(
        `Regla contable requerida para 'hora_personal' no encontrada en empresa ${evento.empresaId}. Configure la regla antes de registrar horas de personal.`,
      );
    }
  }
}
