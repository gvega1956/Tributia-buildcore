import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { zPayloadReposicionCajaChica } from '@tributia/ledger';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { ReglaContableService } from '../regla-contable.service.js';
import { AsientoContableService } from '../asiento-contable.service.js';

/**
 * Handler SÍNCRONO para reposicion_caja_chica (REQUERIDA — ADR-0005).
 *
 * Este evento SOLO se emite después de que la instancia de workflow haya
 * sido APROBADA (ReposicionCajaChicaService verifica el estado antes de emitir).
 *
 *   DEBE  1103.XX  Fondo Caja Chica     (se repone el saldo)
 *   HABER 1101.XX  Bancos               (sale el dinero de la cuenta origen)
 */
@Injectable()
export class ContabilidadReposicionCajaChicaHandler implements ProjectionHandler {
  readonly nombre = 'ContabilidadReposicionCajaChica';
  readonly tiposEvento = ['reposicion_caja_chica'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadReposicionCajaChica.parse(evento.payload);

    const regla = await this.reglaService.findByTipoEvento(tx, evento.empresaId, 'reposicion_caja_chica');
    if (!regla) {
      throw new Error(
        `Regla contable requerida para 'reposicion_caja_chica' no encontrada en empresa ${evento.empresaId}. ` +
          `Configure la regla antes de ejecutar reposiciones de caja chica.`,
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
        descripcion: `Reposición caja chica — ${monto} ${moneda}`,
        lineas,
        usuarioId:   evento.createdBy,
      },
      tx,
    );
  }
}
