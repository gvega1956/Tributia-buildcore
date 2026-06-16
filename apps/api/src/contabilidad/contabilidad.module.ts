import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CuentaContableService } from './cuenta-contable.service.js';
import { ReglaContableService } from './regla-contable.service.js';
import { AsientoContableService } from './asiento-contable.service.js';
import { PeriodoContableService } from './periodo-contable.service.js';
import { TasaCambioService } from './tasa-cambio.service.js';
import { ConsolidacionService } from './consolidacion.service.js';
import { LibroContableService } from './libro-contable.service.js';
import { EstadosFinancierosService } from './estados-financieros.service.js';
import { ContabilidadConsumoMaterialHandler } from './handlers/contabilidad-consumo-material.handler.js';
import { ContabilidadRecepcionMaterialHandler } from './handlers/contabilidad-recepcion-material.handler.js';
import { ContabilidadAjusteInventarioHandler } from './handlers/contabilidad-ajuste-inventario.handler.js';
import { ContabilidadDiferenciaCambiariaHandler } from './handlers/contabilidad-diferencia-cambiaria.handler.js';
import { ContabilidadController } from './contabilidad.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    CuentaContableService,
    ReglaContableService,
    AsientoContableService,
    PeriodoContableService,
    TasaCambioService,
    ConsolidacionService,
    LibroContableService,
    EstadosFinancierosService,
    ContabilidadConsumoMaterialHandler,
    ContabilidadRecepcionMaterialHandler,
    ContabilidadAjusteInventarioHandler,
    ContabilidadDiferenciaCambiariaHandler,
  ],
  controllers: [ContabilidadController],
  exports: [
    CuentaContableService,
    ReglaContableService,
    AsientoContableService,
    PeriodoContableService,
    TasaCambioService,
    ConsolidacionService,
    LibroContableService,
    EstadosFinancierosService,
    ContabilidadConsumoMaterialHandler,
    ContabilidadRecepcionMaterialHandler,
    ContabilidadAjusteInventarioHandler,
    ContabilidadDiferenciaCambiariaHandler,
  ],
})
export class ContabilidadModule {}
