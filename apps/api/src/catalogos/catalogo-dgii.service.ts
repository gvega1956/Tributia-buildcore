import { Injectable } from '@nestjs/common';
import { eq, and, lte, gte, or, isNull, sql } from 'drizzle-orm';
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

  /**
   * Busca un tipo de e-CF vigente a una fecha dada, comparando el código sin
   * distinguir mayúsculas/minúsculas: el catálogo seedeado usa 'e31' y la
   * lógica fiscal de emisión usa 'E31' (ADR-0007 §6).
   */
  async tipoEcfVigente(codigo: string, fecha: Date = new Date()): Promise<TipoEcfSelect | undefined> {
    const codigoNormalizado = codigo.toLowerCase();
    const fechaStr = fecha.toISOString().slice(0, 10);
    const [resultado] = await this.db.tx
      .select()
      .from(tiposEcf)
      .where(
        and(
          sql`lower(${tiposEcf.codigo}) = ${codigoNormalizado}`,
          eq(tiposEcf.activo, true),
          lte(tiposEcf.validoDesde, fechaStr),
          or(isNull(tiposEcf.validoHasta), gte(tiposEcf.validoHasta, fechaStr)),
        ),
      )
      .limit(1);
    return resultado;
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
