import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { zPayloadPagoEmitido } from '@tributia/ledger';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ReglaContableService } from '../regla-contable.service.js';
import { AsientoContableService } from '../asiento-contable.service.js';

/**
 * Handler SÍNCRONO para el evento pago_emitido — asiento contable.
 *
 * Genera el asiento de partida doble por el pago a proveedor:
 *   DEBE  2101.XX  Cuentas por Pagar Proveedores   (se cancela la deuda)
 *   HABER 1101.XX  Bancos / Cuentas de Efectivo     (sale el dinero)
 *
 * Si no hay regla configurada para pago_emitido, avisa por log y no genera
 * el asiento (el pago queda registrado en ejecucion_partida sin contabilidad).
 * Esto es preferible a fallar: el pago operativo ya existe, el asiento
 * puede generarse como ajuste manual cuando se configure la regla.
 */
@Injectable()
export class ContabilidadPagoEmitidoHandler implements ProjectionHandler {
  private readonly logger = new Logger(ContabilidadPagoEmitidoHandler.name);

  readonly nombre = 'ContabilidadPagoEmitido';
  readonly tiposEvento = ['pago_emitido'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const regla = await this.reglaService.findByTipoEvento(tx, evento.empresaId, 'pago_emitido');

    if (!regla) {
      this.logger.warn(
        `Sin regla contable para pago_emitido en empresa ${evento.empresaId} — evento ${evento.id}. Asiento no generado.`,
      );
      return;
    }

    const payload = zPayloadPagoEmitido.parse(evento.payload);
    const monto = new Decimal(payload.monto.amount).toFixed(4);
    const moneda = payload.monto.currency;

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
        tenantId: evento.tenantId,
        empresaId: evento.empresaId,
        tipo: 'automatico',
        eventoId: evento.id,
        reglaId: regla.id,
        fecha: new Date(evento.ocurridoEn).toISOString().slice(0, 10),
        descripcion: `Pago a proveedor — ${monto} ${moneda}`,
        lineas,
        usuarioId: evento.createdBy,
      },
      tx,
    );
  }
}
