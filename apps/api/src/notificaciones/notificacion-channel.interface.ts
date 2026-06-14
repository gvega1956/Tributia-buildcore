import type { NotificacionSelect } from '../db/schema/notificaciones/notificacion.js';
import type { CanalNotificacion } from '@tributia/documental';

/**
 * INotificacionChannel — contrato que todo canal de notificación debe implementar.
 *
 * Implementaciones actuales: SmtpAdapter (EMAIL).
 * Interfaz preparada para futura integración: WhatsAppAdapter (WHATSAPP).
 */
export interface INotificacionChannel {
  readonly canal: CanalNotificacion;
  enviar(notificacion: NotificacionSelect): Promise<void>;
}

export const NOTIFICACION_CHANNELS = 'NOTIFICACION_CHANNELS';
