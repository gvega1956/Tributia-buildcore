import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and, lte, desc } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { tasasCambio, type TasaCambioSelect } from '../db/schema/contabilidad/tasa_cambio.js';
import type { DbTx } from '../ledger/projection.types.js';

export interface RegistrarTasaInput {
  tenantId: string;
  monedaOrigen: string;
  monedaDestino: string;
  tasa: string;
  fecha: string;
  fuente?: string;
  userId: string;
}

@Injectable()
export class TasaCambioService {
  /**
   * Registra la tasa de cambio para una fecha dada.
   * Si ya existe tasa para esa combinación (tenant, monedas, fecha) lanza ConflictException.
   */
  async registrar(tx: DbTx, input: RegistrarTasaInput): Promise<TasaCambioSelect> {
    try {
      const [tasa] = await tx
        .insert(tasasCambio)
        .values({
          id: newId(),
          tenantId: input.tenantId,
          monedaOrigen: input.monedaOrigen,
          monedaDestino: input.monedaDestino,
          tasa: input.tasa,
          fecha: input.fecha,
          fuente: input.fuente ?? null,
          createdBy: input.userId,
          updatedBy: input.userId,
        })
        .returning();

      return tasa!;
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(
          `Ya existe tasa ${input.monedaOrigen}/${input.monedaDestino} para el ${input.fecha}.`,
        );
      }
      throw err;
    }
  }

  /**
   * Devuelve la tasa vigente más reciente para una fecha dada.
   * "Vigente" = la tasa con la fecha más reciente que sea <= fecha buscada.
   * Lanza NotFoundException si no hay tasa registrada.
   *
   * La tasa retornada debe ser registrada en el payload del evento al
   * momento de su ocurrencia (no re-consultada después).
   */
  async getVigenteParaFecha(
    tx: DbTx,
    tenantId: string,
    monedaOrigen: string,
    monedaDestino: string,
    fecha: string,
  ): Promise<TasaCambioSelect> {
    const [tasa] = await tx
      .select()
      .from(tasasCambio)
      .where(and(
        eq(tasasCambio.tenantId, tenantId),
        eq(tasasCambio.monedaOrigen, monedaOrigen),
        eq(tasasCambio.monedaDestino, monedaDestino),
        lte(tasasCambio.fecha, fecha),
      ))
      .orderBy(desc(tasasCambio.fecha))
      .limit(1);

    if (!tasa) {
      throw new NotFoundException(
        `No hay tasa de cambio ${monedaOrigen}/${monedaDestino} registrada para o antes de ${fecha}.`,
      );
    }

    return tasa;
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as Record<string, unknown>)['code'] === '23505'
    );
  }
}
