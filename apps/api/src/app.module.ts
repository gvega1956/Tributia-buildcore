import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { TenancyInterceptor } from './database/tenancy.interceptor.js';
import { AuthModule } from './auth/auth.module.js';
import { IamModule } from './iam/iam.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { CatalogosModule } from './catalogos/catalogos.module.js';
import { WorkflowModule } from './workflow/workflow.module.js';
import { NotificacionesModule } from './notificaciones/notificaciones.module.js';
import { DocumentalModule } from './documental/documental.module.js';
import { ImportadoresModule } from './importadores/importadores.module.js';
import { ProyectosModule } from './proyectos/proyectos.module.js';
import { InventarioModule } from './inventario/inventario.module.js';
import { ComprasModule } from './compras/compras.module.js';
import { ObraModule } from './obra/obra.module.js';
import { OrdenesCambioModule } from './ordenes-cambio/ordenes-cambio.module.js';
import { TableroModule } from './tablero/tablero.module.js';
import { SyncModule } from './sincronizacion/sync.module.js';
import { ContabilidadModule } from './contabilidad/contabilidad.module.js';
import { CxcModule } from './cxc/cxc.module.js';
import { TesoreriaModule } from './tesoreria/tesoreria.module.js';
import { LocalizacionDoModule } from './localizacion-do/localizacion-do.module.js';
import { DocumentosPdfModule } from './documentos-pdf/documentos-pdf.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    IamModule,
    AuthModule,
    LedgerModule,
    CatalogosModule,
    WorkflowModule,
    NotificacionesModule,
    DocumentalModule,
    ImportadoresModule,
    ProyectosModule,
    InventarioModule,
    ComprasModule,
    ObraModule,
    OrdenesCambioModule,
    TableroModule,
    SyncModule,
    ContabilidadModule,
    CxcModule,
    TesoreriaModule,
    LocalizacionDoModule,
    DocumentosPdfModule,
    HealthModule,
  ],
  providers: [
    {
      // Interceptor global: abre transacción con SET LOCAL app.tenant_id para cada request.
      // JwtAuthGuard (en IamModule) ya habrá seteado request.tenantId desde el JWT.
      provide: APP_INTERCEPTOR,
      useClass: TenancyInterceptor,
    },
  ],
})
export class AppModule {}
