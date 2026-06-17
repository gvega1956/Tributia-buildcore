import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { BancoService } from './banco.service.js';
import { ConciliacionBancariaService } from './conciliacion.service.js';
import { CobroService } from './cobro.service.js';
import { CajaChicaService } from './caja-chica.service.js';
import { ReposicionCajaChicaService } from './reposicion.service.js';
import { ProgramacionPagoService } from './programacion-pago.service.js';
import { BancoController } from './banco.controller.js';
import { ConciliacionController } from './conciliacion.controller.js';
import { CajaChicaController } from './caja-chica.controller.js';

@Module({
  imports: [DatabaseModule, LedgerModule, WorkflowModule],
  providers: [
    BancoService,
    ConciliacionBancariaService,
    CobroService,
    CajaChicaService,
    ReposicionCajaChicaService,
    ProgramacionPagoService,
  ],
  controllers: [BancoController, ConciliacionController, CajaChicaController],
  exports: [BancoService, CobroService, CajaChicaService, ProgramacionPagoService],
})
export class TesoreriaModule {}
