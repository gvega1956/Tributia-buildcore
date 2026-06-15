import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { zPayloadAjusteInventario } from '@tributia/ledger';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ReglaContableService } from '../regla-contable.service.js';
import { AsientoContableService } from '../asiento-contable.service.js';

/**
 * Genera asiento para ajuste_inventario.
 *
 * Regla configurada con: debito = cuenta inventario, credito = cuenta ajuste.
 * Si diferencia > 0 (ganancia): DB Inventario / CR Ajuste — se aplica la regla normal.
 * Si diferencia < 0 (pérdida):  DB Ajuste / CR Inventario — se invierten los lados.
 * Si diferencia = 0: no se genera asiento.
 */
@Injectable()
export class ContabilidadAjusteInventarioHandler implements ProjectionHandler {
  private readonly logger = new Logger(ContabilidadAjusteInventarioHandler.name);

  readonly nombre = 'ContabilidadAjusteInventario';
  readonly tiposEvento = ['ajuste_inventario'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadAjusteInventario.parse(evento.payload);
    const diferencia = new Decimal(payload.cantidadFisica).minus(payload.cantidadSistema);

    if (diferencia.isZero()) return;

    const regla = await this.reglaService.findByTipoEvento(tx, evento.empresaId, 'ajuste_inventario');

    if (!regla) {
      this.logger.warn(
        `Sin regla contable para ajuste_inventario en empresa ${evento.empresaId} — evento ${evento.id} sin asiento.`,
      );
      return;
    }

    const importe = diferencia.abs().mul(payload.costoUnitario.amount).toFixed(4);
    const esGanancia = diferencia.greaterThan(0);
    const config = regla.configuracion;

    const lineas = config.lineas.map((lineaRegla) => {
      const ladoNormal = lineaRegla.tipo === 'debito' ? ('debe' as const) : ('haber' as const);
      const ladoInvertido = ladoNormal === 'debe' ? ('haber' as const) : ('debe' as const);
      return {
        cuentaCodigo: lineaRegla.cuentaCodigo,
        tipo: esGanancia ? ladoNormal : ladoInvertido,
        importe,
        moneda: payload.costoUnitario.currency,
        descripcion: lineaRegla.descripcion,
      };
    });

    await this.asientoService.generar(
      {
        tenantId: evento.tenantId,
        empresaId: evento.empresaId,
        tipo: 'ajuste',
        eventoId: evento.id,
        reglaId: regla.id,
        fecha: new Date(evento.ocurridoEn).toISOString().slice(0, 10),
        descripcion: `Ajuste de inventario — evento ${evento.id.slice(0, 8)}`,
        lineas,
        usuarioId: evento.createdBy,
      },
      tx,
    );
  }
}
