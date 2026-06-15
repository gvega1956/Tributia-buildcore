import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CuentaContableService } from './cuenta-contable.service.js';
import { ReglaContableService } from './regla-contable.service.js';
import { AsientoContableService } from './asiento-contable.service.js';
import { ContabilidadConsumoMaterialHandler } from './handlers/contabilidad-consumo-material.handler.js';
import { ContabilidadRecepcionMaterialHandler } from './handlers/contabilidad-recepcion-material.handler.js';
import { ContabilidadAjusteInventarioHandler } from './handlers/contabilidad-ajuste-inventario.handler.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    CuentaContableService,
    ReglaContableService,
    AsientoContableService,
    ContabilidadConsumoMaterialHandler,
    ContabilidadRecepcionMaterialHandler,
    ContabilidadAjusteInventarioHandler,
  ],
  exports: [
    CuentaContableService,
    ReglaContableService,
    AsientoContableService,
    ContabilidadConsumoMaterialHandler,
    ContabilidadRecepcionMaterialHandler,
    ContabilidadAjusteInventarioHandler,
  ],
})
export class ContabilidadModule {}
