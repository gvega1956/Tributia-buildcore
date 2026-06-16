import { Injectable, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { eq, and, sql, isNull, ne } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { cubicaciones, cubicacionLineas } from '../db/schema/cxc/cubicacion.js';
import { proyectos } from '../db/schema/proyectos/proyecto.js';
import { ejecucionPartidas } from '../db/schema/compras/ejecucion_partida.js';
import { versionesPresupuesto, lineasPresupuesto } from '../db/schema/proyectos/presupuesto.js';

const zUUID = z.string().uuid();
const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con máximo 4 decimales');
const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser YYYY-MM-DD');

export const zCubicacionCreateDto = z.object({
  empresaId: zUUID,
  proyectoId: zUUID,
  fechaCorte: zFecha,
  lineas: z
    .array(
      z.object({
        partidaId: zUUID,
        cantidadPeriodo: zDecimal,
      }),
    )
    .min(1),
});

export type CubicacionCreateDto = z.infer<typeof zCubicacionCreateDto>;

/**
 * CubicacionService — certificación de avance físico facturable por período (§16).
 *
 * Invariante central (ADR-0006): cantidad_acumulada certificada en cubicaciones
 * NUNCA puede superar ejecucion_partida.avance_cantidad (el avance "aprobado" —
 * el acumulado de eventos avance_partida del ledger). Esta es la traducción
 * exacta del control "no se puede facturar más avance del aprobado".
 *
 * El precio unitario de facturación viene del presupuesto BASE/APROBADO
 * (linea_presupuesto), nunca del costo — la cubicación factura al precio
 * contractual, no al costo real incurrido.
 */
@Injectable()
export class CubicacionService {
  constructor(private readonly db: DbService) {}

  async crear(tenantId: string, dto: CubicacionCreateDto, usuarioId: string) {
    const now = new Date();

    const [proyecto] = await this.db.tx
      .select()
      .from(proyectos)
      .where(and(eq(proyectos.id, dto.proyectoId), eq(proyectos.tenantId, tenantId)))
      .limit(1);
    if (!proyecto) throw new NotFoundException(`Proyecto ${dto.proyectoId} no encontrado`);

    const [versionBase] = await this.db.tx
      .select()
      .from(versionesPresupuesto)
      .where(
        and(
          eq(versionesPresupuesto.tenantId, tenantId),
          eq(versionesPresupuesto.proyectoId, dto.proyectoId),
          eq(versionesPresupuesto.tipo, 'BASE'),
          eq(versionesPresupuesto.estado, 'APROBADO'),
          isNull(versionesPresupuesto.deletedAt),
        ),
      )
      .limit(1);
    if (!versionBase) {
      throw new UnprocessableEntityException(
        'El proyecto no tiene un presupuesto BASE aprobado — no hay precio contractual para facturar.',
      );
    }

    const lineasInsert: Array<{
      partidaId: string;
      cantidadAnterior: string;
      cantidadPeriodo: string;
      cantidadAcumulada: string;
      precioUnitario: string;
      monto: string;
    }> = [];
    let montoBruto = new Decimal(0);

    for (const lineaDto of dto.lineas) {
      const cantidadPeriodo = new Decimal(lineaDto.cantidadPeriodo);
      if (cantidadPeriodo.lte(0)) {
        throw new BadRequestException(`cantidadPeriodo debe ser positiva (partida ${lineaDto.partidaId})`);
      }

      const [ejecucion] = await this.db.tx
        .select({ avanceCantidad: ejecucionPartidas.avanceCantidad })
        .from(ejecucionPartidas)
        .where(and(eq(ejecucionPartidas.tenantId, tenantId), eq(ejecucionPartidas.partidaId, lineaDto.partidaId)))
        .limit(1);
      const avanceAprobado = new Decimal(ejecucion?.avanceCantidad ?? '0');

      const [lineaPresupuesto] = await this.db.tx
        .select({ precioUnitario: lineasPresupuesto.precioUnitario })
        .from(lineasPresupuesto)
        .where(
          and(
            eq(lineasPresupuesto.versionPresupuestoId, versionBase.id),
            eq(lineasPresupuesto.partidaId, lineaDto.partidaId),
          ),
        )
        .limit(1);
      if (!lineaPresupuesto) {
        throw new NotFoundException(
          `Partida ${lineaDto.partidaId} no tiene línea en el presupuesto BASE — no se puede facturar.`,
        );
      }
      const precioUnitario = new Decimal(lineaPresupuesto.precioUnitario);

      // Cantidad ya certificada en cubicaciones EMITIDAs previas de esta partida
      const [acumPrevio] = await this.db.tx
        .select({ total: sql<string>`coalesce(sum(${cubicacionLineas.cantidadPeriodo}), 0)::text` })
        .from(cubicacionLineas)
        .innerJoin(cubicaciones, eq(cubicaciones.id, cubicacionLineas.cubicacionId))
        .where(
          and(
            eq(cubicacionLineas.tenantId, tenantId),
            eq(cubicacionLineas.partidaId, lineaDto.partidaId),
            ne(cubicaciones.estado, 'ANULADA'),
          ),
        );
      const cantidadAnterior = new Decimal(acumPrevio?.total ?? '0');
      const cantidadAcumulada = cantidadAnterior.plus(cantidadPeriodo);

      if (cantidadAcumulada.gt(avanceAprobado)) {
        throw new UnprocessableEntityException(
          `Partida ${lineaDto.partidaId}: cantidad acumulada a certificar (${cantidadAcumulada.toFixed(4)}) ` +
            `supera el avance físico aprobado (${avanceAprobado.toFixed(4)}). No se puede facturar más avance del aprobado.`,
        );
      }

      const monto = cantidadPeriodo.mul(precioUnitario);
      montoBruto = montoBruto.plus(monto);

      lineasInsert.push({
        partidaId: lineaDto.partidaId,
        cantidadAnterior: cantidadAnterior.toFixed(4),
        cantidadPeriodo: cantidadPeriodo.toFixed(4),
        cantidadAcumulada: cantidadAcumulada.toFixed(4),
        precioUnitario: precioUnitario.toFixed(4),
        monto: monto.toFixed(4),
      });
    }

    const retencionGarantiaPct = proyecto.retencionGarantiaPct
      ? new Decimal(proyecto.retencionGarantiaPct)
      : null;
    const montoRetencionGarantia = retencionGarantiaPct
      ? montoBruto.mul(retencionGarantiaPct).div(100)
      : new Decimal(0);
    const montoFacturable = montoBruto.minus(montoRetencionGarantia);

    const numeroRows = await this.db.tx
      .select({ numero: sql<number>`coalesce(max(numero), 0)::int + 1` })
      .from(cubicaciones)
      .where(and(eq(cubicaciones.tenantId, tenantId), eq(cubicaciones.proyectoId, dto.proyectoId)));
    const numero = numeroRows[0]?.numero ?? 1;

    const cubicacionId = newId();
    const [cubicacion] = await this.db.tx
      .insert(cubicaciones)
      .values({
        id: cubicacionId,
        tenantId,
        empresaId: dto.empresaId,
        proyectoId: dto.proyectoId,
        numero,
        fechaCorte: dto.fechaCorte,
        retencionGarantiaPct: retencionGarantiaPct ? retencionGarantiaPct.toFixed(2) : null,
        montoBruto: montoBruto.toFixed(4),
        montoRetencionGarantia: montoRetencionGarantia.toFixed(4),
        montoFacturable: montoFacturable.toFixed(4),
        moneda: proyecto.monedaContrato,
        estado: 'EMITIDA',
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();

    for (const l of lineasInsert) {
      await this.db.tx.insert(cubicacionLineas).values({
        id: newId(),
        tenantId,
        cubicacionId,
        partidaId: l.partidaId,
        cantidadAnterior: l.cantidadAnterior,
        cantidadPeriodo: l.cantidadPeriodo,
        cantidadAcumulada: l.cantidadAcumulada,
        precioUnitario: l.precioUnitario,
        monto: l.monto,
        moneda: proyecto.monedaContrato,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      });
    }

    return { ...cubicacion!, lineas: lineasInsert };
  }

  async findAll(tenantId: string, proyectoId?: string) {
    const conditions = [eq(cubicaciones.tenantId, tenantId), isNull(cubicaciones.deletedAt)];
    if (proyectoId) conditions.push(eq(cubicaciones.proyectoId, proyectoId));

    return this.db.tx
      .select()
      .from(cubicaciones)
      .where(and(...conditions))
      .orderBy(cubicaciones.numero);
  }

  async findById(tenantId: string, id: string) {
    const [cubicacion] = await this.db.tx
      .select()
      .from(cubicaciones)
      .where(and(eq(cubicaciones.id, id), eq(cubicaciones.tenantId, tenantId)))
      .limit(1);
    if (!cubicacion) throw new NotFoundException(`Cubicación ${id} no encontrada`);

    const lineas = await this.db.tx
      .select()
      .from(cubicacionLineas)
      .where(and(eq(cubicacionLineas.tenantId, tenantId), eq(cubicacionLineas.cubicacionId, id)));

    return { ...cubicacion, lineas };
  }
}
