import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { zPayloadConsumoMaterial } from '@tributia/ledger';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ReglaContableService } from '../regla-contable.service.js';
import { AsientoContableService } from '../asiento-contable.service.js';
@Injectable()
export class ContabilidadConsumoMaterialHandler implements ProjectionHandler {
  private readonly logger = new Logger(ContabilidadConsumoMaterialHandler.name);

  readonly nombre = 'ContabilidadConsumoMaterial';
  readonly tiposEvento = ['consumo_material'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    // Buscar regla contable activa para este tipo de evento en la empresa
    const regla = await this.reglaService.findByTipoEvento(tx, evento.empresaId, 'consumo_material');

    if (!regla) {
      this.logger.warn(
        `Sin regla contable para consumo_material en empresa ${evento.empresaId} — evento ${evento.id} sin asiento.`,
      );
      return;
    }

    const payload = zPayloadConsumoMaterial.parse(evento.payload);
    const costoTotal = new Decimal(payload.cantidad).mul(payload.costoUnitario.amount).toFixed(4);

    const config = regla.configuracion;

    // Mapear líneas de la regla a líneas de asiento con el importe calculado
    const lineas: Array<{ cuentaCodigo: string; tipo: 'debe' | 'haber'; importe: string; moneda: string; descripcion: string }> =
      config.lineas.map((lineaRegla) => ({
        cuentaCodigo: lineaRegla.cuentaCodigo,
        tipo: lineaRegla.tipo === 'debito' ? 'debe' : 'haber',
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
        descripcion: `Consumo de material — evento ${evento.id.slice(0, 8)}`,
        lineas,
        usuarioId: evento.createdBy,
      },
      tx,
    );
  }
}
