import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CuentaContableService } from './cuenta-contable.service.js';
import { ReglaContableService } from './regla-contable.service.js';
import { AsientoContableService } from './asiento-contable.service.js';
import { PeriodoContableService } from './periodo-contable.service.js';
import { TasaCambioService } from './tasa-cambio.service.js';
import { ConsolidacionService } from './consolidacion.service.js';
import { ContabilidadConsumoMaterialHandler } from './handlers/contabilidad-consumo-material.handler.js';
import { ContabilidadRecepcionMaterialHandler } from './handlers/contabilidad-recepcion-material.handler.js';
import { ContabilidadAjusteInventarioHandler } from './handlers/contabilidad-ajuste-inventario.handler.js';
import { ContabilidadDiferenciaCambiariaHandler } from './handlers/contabilidad-diferencia-cambiaria.handler.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    CuentaContableService,
    ReglaContableService,
    AsientoContableService,
    PeriodoContableService,
    TasaCambioService,
    ConsolidacionService,
    ContabilidadConsumoMaterialHandler,
    ContabilidadRecepcionMaterialHandler,
    ContabilidadAjusteInventarioHandler,
    ContabilidadDiferenciaCambiariaHandler,
  ],
  exports: [
    CuentaContableService,
    ReglaContableService,
    AsientoContableService,
    PeriodoContableService,
    TasaCambioService,
    ConsolidacionService,
    ContabilidadConsumoMaterialHandler,
    ContabilidadRecepcionMaterialHandler,
    ContabilidadAjusteInventarioHandler,
    ContabilidadDiferenciaCambiariaHandler,
  ],
})
export class ContabilidadModule {}
