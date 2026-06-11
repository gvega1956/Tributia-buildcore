import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { TenancyInterceptor } from './database/tenancy.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    HealthModule,
  ],
  providers: [
    {
      // Interceptor global: todos los requests pasan por TenancyInterceptor.
      // Los endpoints sin X-Tenant-Id (o JWT en Session 3) se dejan pasar sin TX.
      provide: APP_INTERCEPTOR,
      useClass: TenancyInterceptor,
    },
  ],
})
export class AppModule {}
