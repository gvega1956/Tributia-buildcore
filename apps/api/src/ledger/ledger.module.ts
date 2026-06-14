import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ContabilidadModule } from '../contabilidad/contabilidad.module.js';
import { LedgerService } from './ledger.service.js';
import { ProjectionEngineService } from './projection-engine.service.js';
import { OutboxWorkerService } from './outbox-worker.service.js';
import { ContadorSincronoHandler } from './handlers/contador-sincrono.handler.js';
import { NotificacionAsincronaHandler } from './handlers/notificacion-asincrona.handler.js';
import { ContabilidadConsumoMaterialHandler } from '../contabilidad/handlers/contabilidad-consumo-material.handler.js';
import { PROJECTION_HANDLER_TOKEN } from './projection.types.js';

@Module({
  imports: [DatabaseModule, ContabilidadModule],
  providers: [
    LedgerService,
    ContadorSincronoHandler,
    NotificacionAsincronaHandler,
    {
      provide: PROJECTION_HANDLER_TOKEN,
      useFactory: (
        s: ContadorSincronoHandler,
        a: NotificacionAsincronaHandler,
        c: ContabilidadConsumoMaterialHandler,
      ) => [s, a, c],
      inject: [ContadorSincronoHandler, NotificacionAsincronaHandler, ContabilidadConsumoMaterialHandler],
    },
    ProjectionEngineService,
    OutboxWorkerService,
  ],
  exports: [LedgerService],
})
export class LedgerModule {}
