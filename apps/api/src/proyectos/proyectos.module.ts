import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProyectoService } from './proyecto.service.js';
import { ProyectoController } from './proyecto.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [ProyectoService],
  controllers: [ProyectoController],
  exports: [ProyectoService],
})
export class ProyectosModule {}
