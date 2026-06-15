import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ParteDiarioService } from './parte-diario.service.js';
import { RfiService } from './rfi.service.js';
import { PunchListService } from './punch-list.service.js';
import { ParteDiarioController } from './parte-diario.controller.js';
import { RfiController } from './rfi.controller.js';
import { PunchListController } from './punch-list.controller.js';

@Module({
  imports: [DatabaseModule, LedgerModule],
  providers: [ParteDiarioService, RfiService, PunchListService],
  controllers: [ParteDiarioController, RfiController, PunchListController],
  exports: [ParteDiarioService],
})
export class ObraModule {}
