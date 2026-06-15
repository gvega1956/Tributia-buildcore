import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { lineasPresupuesto, versionesPresupuesto } from '../db/schema/proyectos/presupuesto.js';
import { ejecucionPartidas } from '../db/schema/compras/ejecucion_partida.js';

export interface DisponibilidadPartida {
  partidaId: string;
  presupuestado: string;
  comprometido: string;
  devengado: string;
  disponible: string;
  moneda: string;
}

/**
 * DisponibilidadService — calcula disponible = presupuestado − comprometido − devengado
 * para una o varias partidas de un proyecto.
 *
 * "Presupuestado" viene de la versión BASE APROBADA del presupuesto del proyecto.
 * "Comprometido" y "devengado" vienen de ejecucion_partida (proyección del ledger).
 */
@Injectable()
export class DisponibilidadService {
  constructor(private readonly db: DbService) {}

  async getDisponible(
    tenantId: string,
    proyectoId: string,
    partidaIds: string[],
  ): Promise<DisponibilidadPartida[]> {
    const resultados: DisponibilidadPartida[] = [];

    for (const partidaId of partidaIds) {
      const resultado = await this.getDisponiblePartida(tenantId, proyectoId, partidaId);
      resultados.push(resultado);
    }

    return resultados;
  }

  async getDisponiblePartida(
    tenantId: string,
    proyectoId: string,
    partidaId: string,
  ): Promise<DisponibilidadPartida> {
    // Buscar versión BASE APROBADA del proyecto
    const [versionBase] = await this.db.tx
      .select({ id: versionesPresupuesto.id, moneda: versionesPresupuesto.moneda })
      .from(versionesPresupuesto)
      .where(
        and(
          eq(versionesPresupuesto.tenantId, tenantId),
          eq(versionesPresupuesto.proyectoId, proyectoId),
          eq(versionesPresupuesto.tipo, 'BASE'),
          eq(versionesPresupuesto.estado, 'APROBADO'),
        ),
      )
      .limit(1);

    const moneda = versionBase?.moneda ?? 'DOP';

    // Presupuestado desde linea_presupuesto BASE APROBADA
    let presupuestado = new Decimal(0);
    if (versionBase) {
      const [linea] = await this.db.tx
        .select({ total: lineasPresupuesto.total })
        .from(lineasPresupuesto)
        .where(
          and(
            eq(lineasPresupuesto.versionPresupuestoId, versionBase.id),
            eq(lineasPresupuesto.partidaId, partidaId),
          ),
        )
        .limit(1);

      if (linea) {
        presupuestado = new Decimal(linea.total);
      }
    }

    // Comprometido y devengado desde ejecucion_partida
    const [ejecucion] = await this.db.tx
      .select({
        comprometido: ejecucionPartidas.comprometido,
        devengado: ejecucionPartidas.devengado,
      })
      .from(ejecucionPartidas)
      .where(
        and(
          eq(ejecucionPartidas.tenantId, tenantId),
          eq(ejecucionPartidas.partidaId, partidaId),
        ),
      )
      .limit(1);

    const comprometido = new Decimal(ejecucion?.comprometido ?? 0);
    const devengado = new Decimal(ejecucion?.devengado ?? 0);
    const disponible = presupuestado.minus(comprometido).minus(devengado);

    return {
      partidaId,
      presupuestado: presupuestado.toFixed(4),
      comprometido: comprometido.toFixed(4),
      devengado: devengado.toFixed(4),
      disponible: disponible.toFixed(4),
      moneda,
    };
  }
}
