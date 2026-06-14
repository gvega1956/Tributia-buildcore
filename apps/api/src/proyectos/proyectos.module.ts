import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProyectoService } from './proyecto.service.js';
import { ProyectoController } from './proyecto.controller.js';
import { PartidaService } from './partida.service.js';
import { PartidaController } from './partida.controller.js';
import { ApuService } from './apu.service.js';
import { ApuController, ApuBibliotecaController } from './apu.controller.js';
import { PresupuestoService } from './presupuesto.service.js';
import { PresupuestoController } from './presupuesto.controller.js';
import { PartidaImporter } from '../importadores/partida.importer.js';
import { PresupuestoImporter } from '../importadores/presupuesto.importer.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    ProyectoService,
    PartidaService,
    ApuService,
    PresupuestoService,
    PartidaImporter,
    PresupuestoImporter,
  ],
  controllers: [
    ProyectoController,
    PartidaController,
    ApuController,
    ApuBibliotecaController,
    PresupuestoController,
  ],
  exports: [ProyectoService, PartidaService, ApuService, PresupuestoService],
})
export class ProyectosModule {}
