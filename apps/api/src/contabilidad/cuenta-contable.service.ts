import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { cuentasContables, type CuentaContableSelect } from '../db/schema/contabilidad/cuenta_contable.js';
import type { DbTx } from '../ledger/projection.types.js';

@Injectable()
export class CuentaContableService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Resuelve una cuenta por su código dentro de la empresa.
   * Lanza NotFoundException si el código no existe o la cuenta está inactiva.
   *
   * Usado por AsientoContableService para convertir código → id antes de
   * insertar las líneas del asiento.
   */
  async resolverPorCodigo(
    tx: DbTx,
    empresaId: string,
    codigo: string,
  ): Promise<CuentaContableSelect> {
    const [cuenta] = await tx
      .select()
      .from(cuentasContables)
      .where(
        and(
          eq(cuentasContables.empresaId, empresaId),
          eq(cuentasContables.codigo, codigo),
          eq(cuentasContables.activo, true),
          eq(cuentasContables.esMovimiento, true),
        ),
      )
      .limit(1);

    if (!cuenta) {
      throw new NotFoundException(
        `Cuenta '${codigo}' no encontrada, inactiva o no es cuenta de movimiento (empresa ${empresaId}).`,
      );
    }

    return cuenta;
  }

  /** Devuelve el plan de cuentas completo de una empresa, ordenado por código. */
  async planCompleto(empresaId: string): Promise<CuentaContableSelect[]> {
    return this.dbService.tx
      .select()
      .from(cuentasContables)
      .where(and(eq(cuentasContables.empresaId, empresaId), eq(cuentasContables.activo, true)))
      .orderBy(cuentasContables.codigo);
  }
}
