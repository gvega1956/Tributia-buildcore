import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { zPayloadGastoCajaChica } from '@tributia/ledger';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ReglaContableService } from '../regla-contable.service.js';
import { AsientoContableService } from '../asiento-contable.service.js';

/**
 * Handler SÍNCRONO para gasto_caja_chica (REQUERIDA — ADR-0005).
 *
 *   DEBE  5XXX.XX  Gasto (según regla configurada por empresa)
 *   HABER 1103.XX  Fondo Caja Chica
 *
 * Todo gasto de caja chica debe tener comprobante (NCF, factura o recibo)
 * y referencia a partida de la EDT para mantener la trazabilidad P5.
 */
@Injectable()
export class ContabilidadGastoCajaChicaHandler implements ProjectionHandler {
  readonly nombre = 'ContabilidadGastoCajaChica';
  readonly tiposEvento = ['gasto_caja_chica'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadGastoCajaChica.parse(evento.payload);

    const regla = await this.reglaService.findByTipoEvento(tx, evento.empresaId, 'gasto_caja_chica');
    if (!regla) {
      throw new Error(
        `Regla contable requerida para 'gasto_caja_chica' no encontrada en empresa ${evento.empresaId}. ` +
          `Configure la regla antes de registrar gastos de caja chica.`,
      );
    }

    const monto  = new Decimal(payload.monto.amount).toFixed(4);
    const moneda = payload.monto.currency;
    const config = regla.configuracion;

    const lineas = config.lineas.map(
      (lr: { cuentaCodigo: string; tipo: 'debito' | 'credito'; descripcion?: string }) => ({
        cuentaCodigo: lr.cuentaCodigo,
        tipo:         lr.tipo === 'debito' ? ('debe' as const) : ('haber' as const),
        importe:      monto,
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
        descripcion: `Gasto caja chica — ${payload.concepto.slice(0, 60)}`,
        lineas,
        usuarioId:   evento.createdBy,
      },
      tx,
    );
  }
}
