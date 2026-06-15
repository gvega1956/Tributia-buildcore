import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ContabilidadModule } from '../contabilidad/contabilidad.module.js';
import { LedgerService } from './ledger.service.js';
import { ProjectionEngineService } from './projection-engine.service.js';
import { OutboxWorkerService } from './outbox-worker.service.js';
import { ContadorSincronoHandler } from './handlers/contador-sincrono.handler.js';
import { NotificacionAsincronaHandler } from './handlers/notificacion-asincrona.handler.js';
import { ContabilidadConsumoMaterialHandler } from '../contabilidad/handlers/contabilidad-consumo-material.handler.js';
import { ContabilidadRecepcionMaterialHandler } from '../contabilidad/handlers/contabilidad-recepcion-material.handler.js';
import { ContabilidadAjusteInventarioHandler } from '../contabilidad/handlers/contabilidad-ajuste-inventario.handler.js';
import { InventarioRecepcionMaterialHandler } from '../inventario/handlers/inventario-recepcion-material.handler.js';
import { InventarioConsumoMaterialHandler } from '../inventario/handlers/inventario-consumo-material.handler.js';
import { InventarioTransferenciaAlmacenHandler } from '../inventario/handlers/inventario-transferencia-almacen.handler.js';
import { InventarioAjusteInventarioHandler } from '../inventario/handlers/inventario-ajuste-inventario.handler.js';
import { PROJECTION_HANDLER_TOKEN } from './projection.types.js';

@Module({
  imports: [DatabaseModule, ContabilidadModule],
  providers: [
    LedgerService,
    ContadorSincronoHandler,
    NotificacionAsincronaHandler,
    InventarioRecepcionMaterialHandler,
    InventarioConsumoMaterialHandler,
    InventarioTransferenciaAlmacenHandler,
    InventarioAjusteInventarioHandler,
    {
      provide: PROJECTION_HANDLER_TOKEN,
      useFactory: (
        contador: ContadorSincronoHandler,
        notificacion: NotificacionAsincronaHandler,
        contabConsumo: ContabilidadConsumoMaterialHandler,
        contabRecepcion: ContabilidadRecepcionMaterialHandler,
        contabAjuste: ContabilidadAjusteInventarioHandler,
        invRecepcion: InventarioRecepcionMaterialHandler,
        invConsumo: InventarioConsumoMaterialHandler,
        invTransferencia: InventarioTransferenciaAlmacenHandler,
        invAjuste: InventarioAjusteInventarioHandler,
      ) => [
        contador,
        notificacion,
        contabConsumo,
        contabRecepcion,
        contabAjuste,
        invRecepcion,
        invConsumo,
        invTransferencia,
        invAjuste,
      ],
      inject: [
        ContadorSincronoHandler,
        NotificacionAsincronaHandler,
        ContabilidadConsumoMaterialHandler,
        ContabilidadRecepcionMaterialHandler,
        ContabilidadAjusteInventarioHandler,
        InventarioRecepcionMaterialHandler,
        InventarioConsumoMaterialHandler,
        InventarioTransferenciaAlmacenHandler,
        InventarioAjusteInventarioHandler,
      ],
    },
    ProjectionEngineService,
    OutboxWorkerService,
  ],
  exports: [LedgerService],
})
export class LedgerModule {}
