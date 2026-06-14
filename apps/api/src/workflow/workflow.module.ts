import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TipoFlujoService } from './tipo-flujo.service.js';
import { WorkflowService } from './workflow.service.js';
import { TipoFlujoController } from './tipo-flujo.controller.js';
import { WorkflowController } from './workflow.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [TipoFlujoService, WorkflowService],
  controllers: [TipoFlujoController, WorkflowController],
  exports: [TipoFlujoService, WorkflowService],
})
export class WorkflowModule {}
