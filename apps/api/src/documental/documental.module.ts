import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { ArchivoService } from './archivo.service.js';
import { VencimientoJob } from './vencimiento.job.js';
import { ArchivoController } from './archivo.controller.js';

@Module({
  imports: [DatabaseModule, StorageModule, NotificacionesModule],
  providers: [ArchivoService, VencimientoJob],
  controllers: [ArchivoController],
  exports: [ArchivoService],
})
export class DocumentalModule {}
