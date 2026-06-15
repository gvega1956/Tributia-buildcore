import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { zPayloadRecepcionMaterial } from '@tributia/ledger';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ReglaContableService } from '../regla-contable.service.js';
import { AsientoContableService } from '../asiento-contable.service.js';

@Injectable()
export class ContabilidadRecepcionMaterialHandler implements ProjectionHandler {
  private readonly logger = new Logger(ContabilidadRecepcionMaterialHandler.name);

  readonly nombre = 'ContabilidadRecepcionMaterial';
  readonly tiposEvento = ['recepcion_material'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const regla = await this.reglaService.findByTipoEvento(tx, evento.empresaId, 'recepcion_material');

    if (!regla) {
      this.logger.warn(
        `Sin regla contable para recepcion_material en empresa ${evento.empresaId} — evento ${evento.id} sin asiento.`,
      );
      return;
    }

    const payload = zPayloadRecepcionMaterial.parse(evento.payload);
    const costoTotal = new Decimal(payload.cantidad).mul(payload.costoUnitario.amount).toFixed(4);
    const config = regla.configuracion;

    const lineas = config.lineas.map((lineaRegla) => ({
      cuentaCodigo: lineaRegla.cuentaCodigo,
      tipo: lineaRegla.tipo === 'debito' ? ('debe' as const) : ('haber' as const),
      importe: costoTotal,
      moneda: payload.costoUnitario.currency,
      descripcion: lineaRegla.descripcion,
    }));

    await this.asientoService.generar(
      {
        tenantId: evento.tenantId,
        empresaId: evento.empresaId,
        tipo: 'automatico',
        eventoId: evento.id,
        reglaId: regla.id,
        fecha: new Date(evento.ocurridoEn).toISOString().slice(0, 10),
        descripcion: `Recepción de material — evento ${evento.id.slice(0, 8)}`,
        lineas,
        usuarioId: evento.createdBy,
      },
      tx,
    );
  }
}
