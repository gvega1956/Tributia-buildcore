import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProyectoService } from './proyecto.service.js';
import { ProyectoController } from './proyecto.controller.js';
import { PartidaService } from './partida.service.js';
import { PartidaController } from './partida.controller.js';
import { PartidaImporter } from '../importadores/partida.importer.js';

@Module({
  imports: [DatabaseModule],
  providers: [ProyectoService, PartidaService, PartidaImporter],
  controllers: [ProyectoController, PartidaController],
  exports: [ProyectoService, PartidaService],
})
export class ProyectosModule {}
