import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { tiposEcf, type TipoEcfSelect } from '../db/schema/catalogos/tipo_ecf.js';
import { tasasItbis, type TasaItbisSelect } from '../db/schema/catalogos/tasa_itbis.js';
import { tiposRetencion, type TipoRetencionSelect } from '../db/schema/catalogos/tipo_retencion.js';

@Injectable()
export class CatalogoDgiiService {
  constructor(private readonly db: DbService) {}

  async tiposEcfVigentes(): Promise<TipoEcfSelect[]> {
    return this.db.tx
      .select()
      .from(tiposEcf)
      .where(eq(tiposEcf.activo, true))
      .orderBy(tiposEcf.codigo);
  }

  async tasasItbisVigentes(): Promise<TasaItbisSelect[]> {
    return this.db.tx
      .select()
      .from(tasasItbis)
      .where(eq(tasasItbis.activo, true))
      .orderBy(tasasItbis.porcentaje);
  }

  async tiposRetencionVigentes(): Promise<TipoRetencionSelect[]> {
    return this.db.tx
      .select()
      .from(tiposRetencion)
      .where(eq(tiposRetencion.activo, true))
      .orderBy(tiposRetencion.codigo);
  }
}
