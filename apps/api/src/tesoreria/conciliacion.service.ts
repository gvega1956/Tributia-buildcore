import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import {
  extractosBancarios,
  lineasExtracto,
  type LineaExtractoSelect,
} from '../db/schema/tesoreria/extracto_bancario.js';
import { movimientosBancarios } from '../db/schema/tesoreria/movimiento_bancario.js';

export interface LineaExtractoInput {
  fecha: string;
  descripcion: string;
  monto: string;
  referencia?: string | undefined;
}

export interface ImportarExtractoInput {
  cuentaBancariaId: string;
  empresaId: string;
  periodoDesde: string;
  periodoHasta: string;
  archivoNombre: string;
  lineas: LineaExtractoInput[];
}

export interface ResultadoConciliacion {
  lineaId: string;
  estado: 'CONCILIADA' | 'DIFERENCIA';
  movimientoBancarioId?: string;
}

@Injectable()
export class ConciliacionBancariaService {
  constructor(private readonly db: DbService) {}

  async importarExtracto(tenantId: string, usuarioId: string, input: ImportarExtractoInput) {
    const now = new Date();
    const extractoId = newId();

    await this.db.tx.insert(extractosBancarios).values({
      id: extractoId,
      tenantId,
      empresaId: input.empresaId,
      cuentaBancariaId: input.cuentaBancariaId,
      periodoDesde: input.periodoDesde,
      periodoHasta: input.periodoHasta,
      archivoNombre: input.archivoNombre,
      fechaImportacion: now,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    });

    if (input.lineas.length > 0) {
      await this.db.tx.insert(lineasExtracto).values(
        input.lineas.map((l) => ({
          id: newId(),
          tenantId,
          extractoBancarioId: extractoId,
          fecha: l.fecha,
          descripcion: l.descripcion,
          monto: l.monto,
          referencia: l.referencia ?? null,
          estado: 'PENDIENTE' as const,
          movimientoBancarioId: null,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        })),
      );
    }

    return extractoId;
  }

  /**
   * Intenta conciliar automáticamente todas las líneas PENDIENTE del extracto.
   *
   * Algoritmo: por cada línea, busca un movimiento_bancario sin conciliar en
   * la misma cuenta con el mismo monto absoluto. Si lo encuentra → CONCILIADA.
   * Si no → DIFERENCIA para resolución manual.
   *
   * Monto firmado en extracto: positivo = depósito, negativo = retiro.
   */
  async conciliarAutomatico(
    tenantId: string,
    usuarioId: string,
    extractoBancarioId: string,
  ): Promise<ResultadoConciliacion[]> {
    const [extracto] = await this.db.tx
      .select()
      .from(extractosBancarios)
      .where(
        and(
          eq(extractosBancarios.id, extractoBancarioId),
          eq(extractosBancarios.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!extracto) throw new NotFoundException(`Extracto ${extractoBancarioId} no encontrado.`);

    const lineas = await this.db.tx
      .select()
      .from(lineasExtracto)
      .where(
        and(
          eq(lineasExtracto.extractoBancarioId, extractoBancarioId),
          eq(lineasExtracto.estado, 'PENDIENTE'),
        ),
      );

    const movimientosSinConciliar = await this.db.tx
      .select()
      .from(movimientosBancarios)
      .where(
        and(
          eq(movimientosBancarios.cuentaBancariaId, extracto.cuentaBancariaId),
          eq(movimientosBancarios.conciliado, false),
        ),
      );

    const movimientosMap = new Map<string, (typeof movimientosSinConciliar)[0]>();
    for (const m of movimientosSinConciliar) {
      movimientosMap.set(
        `${m.fecha}::${new Decimal(m.monto).abs().toFixed(4)}::${m.tipo}`,
        m,
      );
    }

    const resultados: ResultadoConciliacion[] = [];
    const now = new Date();

    for (const linea of lineas) {
      const montoLinea = new Decimal(linea.monto);
      const tipoEsperado = montoLinea.gte(0) ? 'DEPOSITO' : 'RETIRO';
      const key = `${linea.fecha}::${montoLinea.abs().toFixed(4)}::${tipoEsperado}`;
      const movimiento = movimientosMap.get(key);

      if (movimiento) {
        movimientosMap.delete(key);

        await this.db.tx
          .update(lineasExtracto)
          .set({
            estado: 'CONCILIADA',
            movimientoBancarioId: movimiento.id,
            updatedAt: now,
            updatedBy: usuarioId,
          })
          .where(eq(lineasExtracto.id, linea.id));

        await this.db.tx
          .update(movimientosBancarios)
          .set({
            conciliado: true,
            lineaExtractoId: linea.id,
            updatedAt: now,
            updatedBy: usuarioId,
          })
          .where(eq(movimientosBancarios.id, movimiento.id));

        resultados.push({ lineaId: linea.id, estado: 'CONCILIADA', movimientoBancarioId: movimiento.id });
      } else {
        await this.db.tx
          .update(lineasExtracto)
          .set({ estado: 'DIFERENCIA', updatedAt: now, updatedBy: usuarioId })
          .where(eq(lineasExtracto.id, linea.id));

        resultados.push({ lineaId: linea.id, estado: 'DIFERENCIA' });
      }
    }

    return resultados;
  }

  async conciliarManual(
    tenantId: string,
    usuarioId: string,
    lineaId: string,
    movimientoBancarioId: string,
  ): Promise<LineaExtractoSelect> {
    const now = new Date();

    const [linea] = await this.db.tx
      .update(lineasExtracto)
      .set({
        estado: 'CONCILIADA',
        movimientoBancarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(
        and(
          eq(lineasExtracto.id, lineaId),
          eq(lineasExtracto.tenantId, tenantId),
        ),
      )
      .returning();

    if (!linea) throw new NotFoundException(`Línea de extracto ${lineaId} no encontrada.`);

    await this.db.tx
      .update(movimientosBancarios)
      .set({
        conciliado: true,
        lineaExtractoId: lineaId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(movimientosBancarios.id, movimientoBancarioId));

    return linea;
  }

  async ignorarLinea(tenantId: string, usuarioId: string, lineaId: string) {
    const now = new Date();
    const [linea] = await this.db.tx
      .update(lineasExtracto)
      .set({ estado: 'IGNORADA', updatedAt: now, updatedBy: usuarioId })
      .where(
        and(
          eq(lineasExtracto.id, lineaId),
          eq(lineasExtracto.tenantId, tenantId),
        ),
      )
      .returning();

    if (!linea) throw new NotFoundException(`Línea de extracto ${lineaId} no encontrada.`);
    return linea;
  }
}
