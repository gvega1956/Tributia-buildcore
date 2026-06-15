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
import { ComprasEmisionOcHandler } from '../compras/handlers/compras-emision-oc.handler.js';
import { ComprasRecepcionOcHandler } from '../compras/handlers/compras-recepcion-oc.handler.js';
import { ComprasRecepcionFacturaProveedorHandler } from '../compras/handlers/compras-recepcion-factura-proveedor.handler.js';
import { ObraAvancePartidaHandler } from '../obra/handlers/obra-avance-partida.handler.js';
import { ObraHoraPersonalHandler } from '../obra/handlers/obra-hora-personal.handler.js';
import { ObraHoraEquipoHandler } from '../obra/handlers/obra-hora-equipo.handler.js';
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
    ComprasEmisionOcHandler,
    ComprasRecepcionOcHandler,
    ComprasRecepcionFacturaProveedorHandler,
    ObraAvancePartidaHandler,
    ObraHoraPersonalHandler,
    ObraHoraEquipoHandler,
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
        comprasEmisionOc: ComprasEmisionOcHandler,
        comprasRecepcionOc: ComprasRecepcionOcHandler,
        comprasRecepcionFactura: ComprasRecepcionFacturaProveedorHandler,
        obraAvance: ObraAvancePartidaHandler,
        obraHoraPersonal: ObraHoraPersonalHandler,
        obraHoraEquipo: ObraHoraEquipoHandler,
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
        comprasEmisionOc,
        comprasRecepcionOc,
        comprasRecepcionFactura,
        obraAvance,
        obraHoraPersonal,
        obraHoraEquipo,
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
        ComprasEmisionOcHandler,
        ComprasRecepcionOcHandler,
        ComprasRecepcionFacturaProveedorHandler,
        ObraAvancePartidaHandler,
        ObraHoraPersonalHandler,
        ObraHoraEquipoHandler,
      ],
    },
    ProjectionEngineService,
    OutboxWorkerService,
  ],
  exports: [LedgerService],
})
export class LedgerModule {}
