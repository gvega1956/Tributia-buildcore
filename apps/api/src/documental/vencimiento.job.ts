import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { tenants } from '../db/schema/core/tenant.js';
import { ArchivoService } from './archivo.service.js';
import { NotificacionService } from '../notificaciones/notificacion.service.js';
import { SYSTEM_USER_ID } from '@tributia/shared';

/**
 * VencimientoJob — cron diario que genera alertas por documentos próximos a vencer.
 *
 * Se ejecuta a las 8:00 AM (UTC) todos los días.
 * Por cada archivo que cumple la condición de alerta (fecha_vencimiento - alerta_dias_antes <= hoy)
 * y no fue alertado hoy, crea una notificación IN_APP para el creador del archivo.
 *
 * Al terminar de procesar un archivo, actualiza ultima_alerta_enviada = hoy para
 * evitar duplicados si el job se ejecuta más de una vez en el día.
 */
@Injectable()
export class VencimientoJob {
  private readonly logger = new Logger(VencimientoJob.name);

  constructor(
    private readonly db: DbService,
    private readonly archivoService: ArchivoService,
    private readonly notificacionService: NotificacionService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkVencimientos(): Promise<void> {
    this.logger.log('Iniciando chequeo de vencimientos documentales...');

    // Obtener todos los tenants activos
    const allTenants = await this.db.adminDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.activo, true));

    let totalAlertas = 0;

    for (const tenant of allTenants) {
      const archivosParaAlertar = await this.archivoService.listParaAlertaHoy(tenant.id);

      for (const archivo of archivosParaAlertar) {
        try {
          const diasRestantes = this.calcularDiasRestantes(archivo.fechaVencimiento!);
          const asunto = `Documento por vencer: ${archivo.nombre}`;
          const cuerpo = diasRestantes > 0
            ? `El documento "${archivo.nombre}" vence en ${diasRestantes} día(s) (${archivo.fechaVencimiento}).`
            : diasRestantes === 0
              ? `El documento "${archivo.nombre}" vence hoy (${archivo.fechaVencimiento}).`
              : `El documento "${archivo.nombre}" venció hace ${Math.abs(diasRestantes)} día(s) (${archivo.fechaVencimiento}).`;

          await this.notificacionService.crear(tenant.id, SYSTEM_USER_ID, {
            usuarioId: archivo.createdBy,
            tipo: 'VENCIMIENTO_DOCUMENTO',
            canal: 'IN_APP',
            asunto,
            cuerpo,
            referenciaTipo: 'archivo',
            referenciaId: archivo.id,
          });

          await this.archivoService.marcarAlertaEnviada(archivo.id, SYSTEM_USER_ID);
          totalAlertas++;
        } catch (err) {
          this.logger.error(`Error procesando alerta para archivo=${archivo.id}`, err);
        }
      }
    }

    this.logger.log(`Chequeo completado: ${totalAlertas} alerta(s) generada(s)`);
  }

  private calcularDiasRestantes(fechaVencimiento: string): number {
    const vencimiento = new Date(fechaVencimiento);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    vencimiento.setHours(0, 0, 0, 0);
    return Math.round((vencimiento.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  }
}
