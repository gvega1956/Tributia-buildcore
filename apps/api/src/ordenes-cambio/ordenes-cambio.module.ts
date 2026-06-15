import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OrdenCambioService } from './orden-cambio.service.js';
import { OrdenCambioController } from './orden-cambio.controller.js';

@Module({
  imports: [DatabaseModule, LedgerModule],
  providers: [OrdenCambioService],
  controllers: [OrdenCambioController],
  exports: [OrdenCambioService],
})
export class OrdenesCambioModule {}
