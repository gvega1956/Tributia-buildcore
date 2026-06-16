import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { RetencionClienteService } from './retencion-cliente.service.js';
import { CubicacionService } from './cubicacion.service.js';
import { FacturaClienteService } from './factura-cliente.service.js';
import { CuentaPorCobrarService } from './cuenta-por-cobrar.service.js';
import { AgingService } from './aging.service.js';
import { CubicacionController } from './cubicacion.controller.js';
import { FacturaClienteController } from './factura-cliente.controller.js';
import { CuentaPorCobrarController } from './cuenta-por-cobrar.controller.js';

@Module({
  imports: [DatabaseModule, LedgerModule],
  providers: [
    RetencionClienteService,
    CubicacionService,
    FacturaClienteService,
    CuentaPorCobrarService,
    AgingService,
  ],
  controllers: [CubicacionController, FacturaClienteController, CuentaPorCobrarController],
  exports: [CubicacionService, FacturaClienteService, CuentaPorCobrarService, AgingService],
})
export class CxcModule {}
