import { Module } from '@nestjs/common';
import { DbService } from './db.service.js';
import { TenancyInterceptor } from './tenancy.interceptor.js';

@Module({
  providers: [DbService, TenancyInterceptor],
  exports: [DbService, TenancyInterceptor],
})
export class DatabaseModule {}
