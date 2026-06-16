import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { zPayloadCobroRecibido } from '@tributia/ledger';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ReglaContableService } from '../regla-contable.service.js';
import { AsientoContableService } from '../asiento-contable.service.js';

/**
 * Genera asiento de diferencia cambiaria cuando un cobro se recibe
 * a una tasa distinta a la de la factura original.
 *
 * Si tasaCobro > tasaFactura → ganancia cambiaria (regla: diferencia_cambiaria_ganancia)
 * Si tasaCobro < tasaFactura → pérdida cambiaria   (regla: diferencia_cambiaria_perdida)
 * Si tasas iguales           → no hay asiento
 *
 * La diferencia se calcula en monedaBase: montoCobrado.amount × (tasaCobro - tasaFactura)
 */
@Injectable()
export class ContabilidadDiferenciaCambiariaHandler implements ProjectionHandler {
  private readonly logger = new Logger(ContabilidadDiferenciaCambiariaHandler.name);

  readonly nombre = 'ContabilidadDiferenciaCambiaria';
  readonly tiposEvento = ['cobro_recibido'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadCobroRecibido.parse(evento.payload);

    const tasaFactura = new Decimal(payload.tasaFactura);
    const tasaCobro   = new Decimal(payload.tasaCobro);
    const diferencia  = new Decimal(payload.montoCobrado.amount).mul(tasaCobro.minus(tasaFactura));

    if (diferencia.isZero()) return;

    const esGanancia = diferencia.gt(0);
    const tipoRegla  = esGanancia ? 'diferencia_cambiaria_ganancia' : 'diferencia_cambiaria_perdida';

    const regla = await this.reglaService.findByTipoEvento(tx, evento.empresaId, tipoRegla);

    if (!regla) {
      this.logger.warn(
        `Sin regla contable para ${tipoRegla} en empresa ${evento.empresaId} — diferencia cambiaria sin asiento.`,
      );
      return;
    }

    const importe = diferencia.abs().toFixed(4);
    const config  = regla.configuracion;

    const lineas = config.lineas.map((lineaRegla) => ({
      cuentaCodigo: lineaRegla.cuentaCodigo,
      tipo: lineaRegla.tipo === 'debito' ? ('debe' as const) : ('haber' as const),
      importe,
      moneda: payload.monedaBase,
      descripcion: lineaRegla.descripcion,
    }));

    const descripcion = esGanancia
      ? `Ganancia cambiaria — cobro ${evento.id.slice(0, 8)}`
      : `Pérdida cambiaria — cobro ${evento.id.slice(0, 8)}`;

    await this.asientoService.generar(
      {
        tenantId:    evento.tenantId,
        empresaId:   evento.empresaId,
        tipo:        'automatico',
        eventoId:    evento.id,
        reglaId:     regla.id,
        fecha:       new Date(evento.ocurridoEn).toISOString().slice(0, 10),
        descripcion,
        lineas,
        usuarioId:   evento.createdBy,
      },
      tx,
    );
  }
}
