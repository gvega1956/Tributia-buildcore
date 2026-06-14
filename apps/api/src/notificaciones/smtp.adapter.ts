import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { INotificacionChannel } from './notificacion-channel.interface.js';
import type { NotificacionSelect } from '../db/schema/notificaciones/notificacion.js';

/**
 * SmtpAdapter — canal EMAIL via SMTP (nodemailer).
 *
 * Variables de entorno opcionales:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Si no están configuradas, el adaptador opera en modo "log-only" (útil en
 * desarrollo y tests). No lanza errores para no bloquear la operación principal.
 */
@Injectable()
export class SmtpAdapter implements INotificacionChannel {
  readonly canal = 'EMAIL' as const;
  private readonly logger = new Logger(SmtpAdapter.name);
  private transporter: Transporter | null = null;
  private fromAddress: string;

  constructor(
    @Optional() private readonly config?: ConfigService,
  ) {
    const host = config?.get<string>('SMTP_HOST');
    const port = config?.get<number>('SMTP_PORT') ?? 587;
    const user = config?.get<string>('SMTP_USER');
    const pass = config?.get<string>('SMTP_PASS');
    this.fromAddress = config?.get<string>('SMTP_FROM') ?? 'noreply@tributia.app';

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user && pass ? { user, pass } : undefined,
      });
      this.logger.log(`SMTP configurado: ${host}:${port}`);
    } else {
      this.logger.warn('SMTP_HOST no configurado — correos se registran solo en log');
    }
  }

  async enviar(notificacion: NotificacionSelect): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `[EMAIL-LOG] Para: usuario=${notificacion.usuarioId} | Asunto: ${notificacion.asunto}`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: notificacion.usuarioId, // En producción se resolvería el email del usuario
        subject: notificacion.asunto,
        text: notificacion.cuerpo,
        html: `<p>${notificacion.cuerpo.replace(/\n/g, '<br>')}</p>`,
      });
      this.logger.log(`Email enviado: usuario=${notificacion.usuarioId}`);
    } catch (err) {
      this.logger.error(`Fallo al enviar email para notificacion=${notificacion.id}`, err);
    }
  }
}
