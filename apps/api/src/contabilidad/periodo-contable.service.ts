import { Injectable, UnprocessableEntityException, ConflictException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { newId } from '@tributia/shared';
import { periodosContables, type PeriodoContableSelect } from '../db/schema/contabilidad/periodo_contable.js';
import { checklistCierre } from '../db/schema/contabilidad/checklist_cierre.js';
import { asientosContables } from '../db/schema/contabilidad/asiento_contable.js';
import { lineasAsiento } from '../db/schema/contabilidad/linea_asiento.js';
import { cuentasContables } from '../db/schema/contabilidad/cuenta_contable.js';
import type { DbTx } from '../ledger/projection.types.js';

export interface ResumenCierreEjercicio {
  asientoId: string;
  totalIngresos: string;
  totalGastos: string;
  resultadoNeto: string;
}

@Injectable()
export class PeriodoContableService {
  /**
   * Valida que el período contable correspondiente a `fecha` (YYYY-MM-DD)
   * esté ABIERTO o REABIERTO para la empresa.
   * Si el período está CERRADO lanza UnprocessableEntityException.
   * Si no existe período registrado, se considera ABIERTO por defecto.
   */
  async validarPeriodoAbierto(tx: DbTx, empresaId: string, fecha: string): Promise<void> {
    const { anio, mes } = this.parseFecha(fecha);

    const [periodo] = await tx
      .select({ estado: periodosContables.estado })
      .from(periodosContables)
      .where(and(
        eq(periodosContables.empresaId, empresaId),
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

  /**
   * Cierra el período (anio, mes) para la empresa.
   *
   * Precondiciones:
   *   1. El período no debe estar ya CERRADO.
   *   2. Todos los ítems del checklist requeridos deben estar completados.
   *
   * Post: upsert del período con estado=CERRADO + fechaCierre.
   */
  async cerrar(
    tx: DbTx,
    tenantId: string,
    empresaId: string,
    anio: number,
    mes: number,
    userId: string,
  ): Promise<PeriodoContableSelect> {
    // 1. Verificar estado actual
    const [actual] = await tx
      .select()
      .from(periodosContables)
      .where(and(
        eq(periodosContables.empresaId, empresaId),
        eq(periodosContables.anio, anio),
        eq(periodosContables.mes, mes),
      ))
      .limit(1);

    if (actual?.estado === 'CERRADO') {
      throw new ConflictException(`Período ${anio}-${String(mes).padStart(2, '0')} ya está cerrado.`);
    }

    // 2. Verificar checklist
    const pendientes = await tx
      .select({ id: checklistCierre.id, nombre: checklistCierre.nombre })
      .from(checklistCierre)
      .where(and(
        eq(checklistCierre.empresaId, empresaId),
        eq(checklistCierre.anio, anio),
        eq(checklistCierre.mes, mes),
        eq(checklistCierre.requerido, true),
        eq(checklistCierre.completado, false),
      ));

    if (pendientes.length > 0) {
      const nombres = pendientes.map((p) => p.nombre).join(', ');
      throw new UnprocessableEntityException(
        `No se puede cerrar el período: ítems pendientes en checklist: ${nombres}`,
      );
    }

    // 3. Upsert período → CERRADO
    const now = new Date();
    const [periodo] = await tx
      .insert(periodosContables)
      .values({
        id: newId(),
        tenantId,
        empresaId,
        anio,
        mes,
        estado: 'CERRADO',
        fechaCierre: now,
        cerradoPor: userId,
        createdBy: userId,
        updatedBy: userId,
      })
      .onConflictDoUpdate({
        target: [periodosContables.empresaId, periodosContables.anio, periodosContables.mes],
        set: {
          estado: 'CERRADO',
          fechaCierre: now,
          cerradoPor: userId,
          updatedAt: now,
          updatedBy: userId,
        },
      })
      .returning();

    return periodo!;
  }

  /**
   * Reabre un período CERRADO.
   * Requiere motivo (registrado para auditoría).
   */
  async reabrir(
    tx: DbTx,
    tenantId: string,
    empresaId: string,
    anio: number,
    mes: number,
    userId: string,
    motivo: string,
  ): Promise<PeriodoContableSelect> {
    const [actual] = await tx
      .select()
      .from(periodosContables)
      .where(and(
        eq(periodosContables.empresaId, empresaId),
        eq(periodosContables.anio, anio),
        eq(periodosContables.mes, mes),
      ))
      .limit(1);

    if (!actual) {
      throw new UnprocessableEntityException(
        `Período ${anio}-${String(mes).padStart(2, '0')} no existe. Ciérrelo antes de reabrirlo.`,
      );
    }
    if (actual.estado !== 'CERRADO') {
      throw new ConflictException(
        `Período ${anio}-${String(mes).padStart(2, '0')} no está CERRADO (está ${actual.estado}).`,
      );
    }
    if (!motivo?.trim()) {
      throw new UnprocessableEntityException('Se requiere motivo para reapertura de período.');
    }

    const now = new Date();
    const [periodo] = await tx
      .update(periodosContables)
      .set({
        estado: 'REABIERTO',
        fechaReapertura: now,
        reabiertoPor: userId,
        motivoReapertura: motivo,
        updatedAt: now,
        updatedBy: userId,
      })
      .where(eq(periodosContables.id, actual.id))
      .returning();

    return periodo!;
  }

  /**
   * Genera el asiento de cierre de resultados del ejercicio.
   *
   * Suma los saldos netos de las cuentas de ingreso y gasto/costo,
   * genera un asiento que salda esas cuentas contra la cuenta de
   * Utilidad/Pérdida del Ejercicio (tipo='patrimonio').
   *
   * Para que el asiento sea válido, la empresa debe tener una cuenta
   * de tipo='patrimonio' activa (usada como contrapartida de cierre).
   */
  async generarAsientoCierreEjercicio(
    tx: DbTx,
    tenantId: string,
    empresaId: string,
    anio: number,
    userId: string,
    cuentaResultadosCodigo: string,
  ): Promise<ResumenCierreEjercicio> {
    // Sumar débitos y créditos por tipo de cuenta para el año
    const saldos = await tx
      .select({
        tipoCuenta: cuentasContables.tipo,
        cuentaId: cuentasContables.id,
        codigoCuenta: cuentasContables.codigo,
        totalDebe: sql<string>`COALESCE(SUM(CASE WHEN ${lineasAsiento.tipo} = 'debe' THEN ${lineasAsiento.importe}::numeric ELSE 0 END), 0)::text`,
        totalHaber: sql<string>`COALESCE(SUM(CASE WHEN ${lineasAsiento.tipo} = 'haber' THEN ${lineasAsiento.importe}::numeric ELSE 0 END), 0)::text`,
      })
      .from(cuentasContables)
      .leftJoin(lineasAsiento, eq(lineasAsiento.cuentaId, cuentasContables.id))
      .leftJoin(asientosContables, and(
        eq(asientosContables.id, lineasAsiento.asientoId),
        sql`EXTRACT(YEAR FROM ${asientosContables.fecha}::date) = ${anio}`,
      ))
      .where(and(
        eq(cuentasContables.empresaId, empresaId),
        eq(cuentasContables.activo, true),
        sql`${cuentasContables.tipo} IN ('ingreso','gasto','costo')`,
      ))
      .groupBy(cuentasContables.tipo, cuentasContables.id, cuentasContables.codigo);

    // Calcular resultado neto: ingreso - gasto - costo
    let totalIngresos = new Decimal(0);
    let totalGastos = new Decimal(0);

    const lineasCierre: Array<{ cuentaId: string; tipo: 'debe' | 'haber'; importe: string }> = [];

    for (const s of saldos) {
      const debe = new Decimal(s.totalDebe);
      const haber = new Decimal(s.totalHaber);
      const saldo = haber.minus(debe); // Saldo normal de cuentas de resultado

      if (s.tipoCuenta === 'ingreso') {
        // Cuentas de ingreso tienen saldo acreedor (haber > debe)
        // Cierre: DB cuenta ingreso / CR utilidad del ejercicio
        if (saldo.gt(0)) {
          totalIngresos = totalIngresos.plus(saldo);
          lineasCierre.push({ cuentaId: s.cuentaId, tipo: 'debe', importe: saldo.toFixed(4) });
        }
      } else {
        // Cuentas de gasto/costo tienen saldo deudor (debe > haber)
        const saldoGasto = debe.minus(haber);
        if (saldoGasto.gt(0)) {
          totalGastos = totalGastos.plus(saldoGasto);
          lineasCierre.push({ cuentaId: s.cuentaId, tipo: 'haber', importe: saldoGasto.toFixed(4) });
        }
      }
    }

    const resultadoNeto = totalIngresos.minus(totalGastos);

    // Cuenta de resultados (Utilidad/Pérdida del ejercicio)
    const [cuentaResultados] = await tx
      .select()
      .from(cuentasContables)
      .where(and(
        eq(cuentasContables.empresaId, empresaId),
        eq(cuentasContables.codigo, cuentaResultadosCodigo),
        eq(cuentasContables.activo, true),
      ))
      .limit(1);

    if (!cuentaResultados) {
      throw new UnprocessableEntityException(
        `Cuenta de resultados '${cuentaResultadosCodigo}' no encontrada para la empresa.`,
      );
    }

    // Contrapartida: si resultado > 0 (ganancia) → CR cuenta resultados; si pérdida → DB
    if (resultadoNeto.gt(0)) {
      lineasCierre.push({ cuentaId: cuentaResultados.id, tipo: 'haber', importe: resultadoNeto.toFixed(4) });
    } else if (resultadoNeto.lt(0)) {
      lineasCierre.push({ cuentaId: cuentaResultados.id, tipo: 'debe', importe: resultadoNeto.abs().toFixed(4) });
    }

    if (lineasCierre.length === 0) {
      throw new UnprocessableEntityException(`Sin cuentas de resultado para el ejercicio ${anio}.`);
    }

    // Generar el asiento de cierre
    const asientoId = newId();
    const numero = `AST-CIERRE-${anio}-${empresaId.slice(-6).toUpperCase()}`;

    const [asiento] = await tx
      .insert(asientosContables)
      .values({
        id: asientoId,
        tenantId,
        empresaId,
        numero,
        tipo: 'cierre',
        fecha: `${anio}-12-31`,
        descripcion: `Asiento de cierre de resultados ejercicio ${anio}`,
        estado: 'confirmado',
        aprobadoPor: userId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    for (const linea of lineasCierre) {
      await tx.insert(lineasAsiento).values({
        id: newId(),
        tenantId,
        asientoId: asiento!.id,
        cuentaId: linea.cuentaId,
        tipo: linea.tipo,
        importe: linea.importe,
        moneda: 'DOP',
        descripcion: `Cierre ejercicio ${anio}`,
      });
    }

    return {
      asientoId: asiento!.id,
      totalIngresos: totalIngresos.toFixed(4),
      totalGastos: totalGastos.toFixed(4),
      resultadoNeto: resultadoNeto.toFixed(4),
    };
  }

  private parseFecha(fecha: string): { anio: number; mes: number } {
    const [anioStr, mesStr] = fecha.split('-');
    return { anio: parseInt(anioStr!, 10), mes: parseInt(mesStr!, 10) };
  }
}
