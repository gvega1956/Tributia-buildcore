import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SyncService } from './sync.service.js';
import { FotoCampoService } from './foto.service.js';
import { SyncController } from './sync.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [SyncService, FotoCampoService],
  controllers: [SyncController],
  exports: [SyncService, FotoCampoService],
})
export class SyncModule {}
