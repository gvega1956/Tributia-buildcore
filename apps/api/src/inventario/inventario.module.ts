import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { AlmacenService } from './almacen.service.js';
import { InventarioService } from './inventario.service.js';
import { AlmacenController } from './almacen.controller.js';
import { InventarioController } from './inventario.controller.js';

@Module({
  imports: [DatabaseModule, LedgerModule],
  providers: [AlmacenService, InventarioService],
  controllers: [AlmacenController, InventarioController],
  exports: [AlmacenService, InventarioService],
})
export class InventarioModule {}
