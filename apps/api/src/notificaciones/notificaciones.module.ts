import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SmtpAdapter } from './smtp.adapter.js';
import { NotificacionService } from './notificacion.service.js';
import { NotificacionController } from './notificacion.controller.js';
import { NOTIFICACION_CHANNELS } from './notificacion-channel.interface.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    SmtpAdapter,
    {
      provide: NOTIFICACION_CHANNELS,
      useFactory: (smtp: SmtpAdapter) => [smtp],
      inject: [SmtpAdapter],
    },
    NotificacionService,
  ],
  controllers: [NotificacionController],
  exports: [NotificacionService],
})
export class NotificacionesModule {}
