import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CatalogosModule } from '../catalogos/catalogos.module.js';
import { ImportadorController } from './importador.controller.js';

@Module({
  imports: [DatabaseModule, CatalogosModule],
  controllers: [ImportadorController],
})
export class ImportadoresModule {}
