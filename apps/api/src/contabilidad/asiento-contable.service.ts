import { Injectable, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { validarBalance, type AsientoInput, type LineaAsientoInput } from '@tributia/contabilidad';
import { asientosContables, type AsientoContableSelect } from '../db/schema/contabilidad/asiento_contable.js';
import { lineasAsiento } from '../db/schema/contabilidad/linea_asiento.js';
import { periodosContables } from '../db/schema/contabilidad/periodo_contable.js';
import { DbService } from '../database/db.service.js';
import { CuentaContableService } from './cuenta-contable.service.js';
import type { DbTx } from '../ledger/projection.types.js';

@Injectable()
export class AsientoContableService {
  constructor(
    private readonly dbService: DbService,
    private readonly cuentaService: CuentaContableService,
  ) {}

  /**
   * Genera y persiste un asiento de partida doble dentro de la transacción activa.
   *
   * Garantías:
   *   1. Valida balance (Σdebe = Σhaber) antes de tocar la BD.
   *   2. Resuelve códigos de cuenta → ids en la misma tx.
   *   3. Inserta asiento + lineas atómicamente.
   *   4. Idempotencia en capa BD: UNIQUE(evento_id, regla_id) rechaza re-procesamiento.
   *
   * Si las lineas no balancean → BadRequestException (toda la tx se revierte,
   * incluido el evento origen — garantía de atomicidad síncrona).
   */
  async generar(input: AsientoInput, tx: DbTx, skipPeriodCheck = false): Promise<AsientoContableSelect> {
    // Bloqueo de período cerrado (motor contable, no solo UI).
    // Tipos manuales (ajuste, apertura) con skipPeriodCheck=true bypass en cierre de ejercicio.
    if (!skipPeriodCheck && input.tipo !== 'apertura') {
      const [anioStr, mesStr] = input.fecha.split('-');
      const anio = parseInt(anioStr!, 10);
      const mes  = parseInt(mesStr!, 10);
      if (!isNaN(anio) && !isNaN(mes)) {
        const [periodo] = await tx
          .select({ estado: periodosContables.estado })
          .from(periodosContables)
          .where(and(
            eq(periodosContables.empresaId, input.empresaId),
            eq(periodosContables.anio, anio),
            eq(periodosContables.mes, mes),
          ))
          .limit(1);
        if (periodo?.estado === 'CERRADO') {
          throw new UnprocessableEntityException(
            `Período ${anio}-${String(mes).padStart(2, '0')} está cerrado. Reapertura requerida (permiso REAPERTURA_PERIODO).`,
          );
        }
      }
    }

    if (!validarBalance(input.lineas)) {
      const debe = input.lineas
        .filter((l: LineaAsientoInput) => l.tipo === 'debe')
        .reduce((s: number, l: LineaAsientoInput) => s + parseFloat(l.importe), 0);
      const haber = input.lineas
        .filter((l: LineaAsientoInput) => l.tipo === 'haber')
        .reduce((s: number, l: LineaAsientoInput) => s + parseFloat(l.importe), 0);
      throw new BadRequestException(
        `Asiento desbalanceado: Σdebe=${debe.toFixed(4)} ≠ Σhaber=${haber.toFixed(4)}`,
      );
    }

    const year = new Date().getUTCFullYear();
    const asientoId = newId();
    const numero = `AST-${year}-${asientoId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const [asiento] = await tx
      .insert(asientosContables)
      .values({
        id: asientoId,
        tenantId: input.tenantId,
        empresaId: input.empresaId,
        numero,
        tipo: input.tipo,
        eventoId: input.eventoId ?? null,
        reglaId: input.reglaId ?? null,
        fecha: input.fecha,
        descripcion: input.descripcion,
        estado: 'borrador',
        aprobadoPor: input.tipo === 'ajuste' ? (input.usuarioId ?? null) : null,
        createdBy: input.usuarioId,
        updatedBy: input.usuarioId,
      })
      .returning();

    for (const linea of input.lineas) {
      const cuenta = await this.cuentaService.resolverPorCodigo(tx, input.empresaId, linea.cuentaCodigo);

      await tx.insert(lineasAsiento).values({
        id: newId(),
        tenantId: input.tenantId,
        asientoId: asiento!.id,
        cuentaId: cuenta.id,
        tipo: linea.tipo,
        importe: linea.importe,
        moneda: linea.moneda,
        descripcion: linea.descripcion ?? null,
      });
    }

    return asiento!;
  }

  /**
   * Registra un asiento de ajuste manual.
   * Requiere permiso ASIENTO_MANUAL (validado en el controller, no aquí).
   * El usuario se registra como aprobador — todo ajuste queda auditado.
   */
  async registrarAjuste(input: Omit<AsientoInput, 'tipo' | 'eventoId' | 'reglaId'>, tx: DbTx): Promise<AsientoContableSelect> {
    return this.generar({ ...input, tipo: 'ajuste' }, tx);
  }

  /** Verifica el balance de un asiento existente (útil en tests de integración). */
  async verificarBalance(asientoId: string): Promise<boolean> {
    const lineas = await this.dbService.tx
      .select()
      .from(lineasAsiento)
      .where(eq(lineasAsiento.asientoId, asientoId));

    type L = typeof lineas[0];
    const debe = lineas.filter((l: L) => l.tipo === 'debe').reduce((s: number, l: L) => s + parseFloat(l.importe), 0);
    const haber = lineas.filter((l: L) => l.tipo === 'haber').reduce((s: number, l: L) => s + parseFloat(l.importe), 0);
    return Math.abs(debe - haber) < 0.0001;
  }
}
