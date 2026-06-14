import { Injectable } from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import { reglasContables, type ReglaContableSelect } from '../db/schema/contabilidad/regla_contable.js';
import type { DbTx } from '../ledger/projection.types.js';

@Injectable()
export class ReglaContableService {
  /**
   * Devuelve la regla activa de menor prioridad para el tipo de evento dado.
   * Retorna null si no hay regla configurada (el handler la omite gracefully).
   */
  async findByTipoEvento(
    tx: DbTx,
    empresaId: string,
    tipoEvento: string,
  ): Promise<ReglaContableSelect | null> {
    const [regla] = await tx
      .select()
      .from(reglasContables)
      .where(
        and(
          eq(reglasContables.empresaId, empresaId),
          eq(reglasContables.tipoEvento, tipoEvento),
          eq(reglasContables.activo, true),
        ),
      )
      .orderBy(asc(reglasContables.prioridad))
      .limit(1);

    return regla ?? null;
  }
}
