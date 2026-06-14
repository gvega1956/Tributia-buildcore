import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TerceroService } from './tercero.service.js';
import { InsumoService } from './insumo.service.js';
import { EquipoCatalogoService } from './equipo-catalogo.service.js';
import { CatalogoDgiiService } from './catalogo-dgii.service.js';
import { TerceroController } from './tercero.controller.js';
import { InsumoController } from './insumo.controller.js';
import { EquipoCatalogoController } from './equipo-catalogo.controller.js';
import { CatalogoDgiiController } from './catalogo-dgii.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [TerceroService, InsumoService, EquipoCatalogoService, CatalogoDgiiService],
  controllers: [TerceroController, InsumoController, EquipoCatalogoController, CatalogoDgiiController],
  exports: [TerceroService, InsumoService, EquipoCatalogoService, CatalogoDgiiService],
})
export class CatalogosModule {}
