import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TableroService } from './tablero.service.js';
import { TableroController } from './tablero.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [TableroService],
  controllers: [TableroController],
  exports: [TableroService],
})
export class TableroModule {}
