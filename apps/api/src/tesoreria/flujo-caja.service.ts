import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { cuentasPorCobrar } from '../db/schema/cxc/cuenta_por_cobrar.js';
import { cubicacionesProyectadas } from '../db/schema/cxc/cubicacion_proyectada.js';
import { cuentasPorPagar } from '../db/schema/compras/cuenta_por_pagar.js';
import { ordenesCompra, lineasOrdenCompra } from '../db/schema/compras/orden_compra.js';
import { partidas } from '../db/schema/proyectos/partida.js';
import { programacionesPago } from '../db/schema/tesoreria/programacion_pago.js';
import { cuentasBancarias } from '../db/schema/tesoreria/cuenta_bancaria.js';

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export type TipoFlujo =
  | 'CXC_PENDIENTE'
  | 'CXC_PROYECTADA'
  | 'CXP_PENDIENTE'
  | 'OC_COMPROMETIDA'
  | 'PAGO_PROGRAMADO';

/** Un ítem de cobro o pago con trazabilidad completa al documento origen (P8). */
export interface ItemFlujo {
  tipo: TipoFlujo;
  referenciaId: string;
  referenciaTipo: string;
  descripcion: string;
  monto: string;
  moneda: string;
  fechaEsperada: string;
}

export interface SemanaCaja {
  semana: number;
  inicioSemana: string;
  finSemana: string;
  inflows: ItemFlujo[];
  outflows: ItemFlujo[];
  totalInflows: string;
  totalOutflows: string;
  posicionNeta: string;
  posicionAcumulada: string;
  alertaDeficit: boolean;
}

export interface ResultadoFlujo {
  saldoInicial: string;
  moneda: string;
  horizonte: number;
  semanas: SemanaCaja[];
}

export interface CubicacionProyectadaInput {
  empresaId: string;
  proyectoId: string;
  fechaProyectada: string;
  montoProyectado: string;
  moneda?: string | undefined;
  descripcion?: string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class FlujoCajaService {
  constructor(private readonly db: DbService) {}

  // ── CRUD cubicacion_proyectada ─────────────────────────────────────────────

  async registrarCubicacionProyectada(
    tenantId: string,
    usuarioId: string,
    input: CubicacionProyectadaInput,
  ) {
    const now = new Date();
    const [cub] = await this.db.tx
      .insert(cubicacionesProyectadas)
      .values({
        id: newId(),
        tenantId,
        empresaId: input.empresaId,
        proyectoId: input.proyectoId,
        fechaProyectada: input.fechaProyectada,
        montoProyectado: input.montoProyectado,
        moneda: input.moneda ?? 'DOP',
        descripcion: input.descripcion ?? null,
        cubicacionId: null,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();
    return cub!;
  }

  async listarCubicacionesProyectadas(tenantId: string, proyectoId: string) {
    return this.db.tx
      .select()
      .from(cubicacionesProyectadas)
      .where(
        and(
          eq(cubicacionesProyectadas.tenantId, tenantId),
          eq(cubicacionesProyectadas.proyectoId, proyectoId),
          isNull(cubicacionesProyectadas.deletedAt),
        ),
      )
      .orderBy(cubicacionesProyectadas.fechaProyectada);
  }

  async eliminarCubicacionProyectada(tenantId: string, id: string, usuarioId: string) {
    const now = new Date();
    const [updated] = await this.db.tx
      .update(cubicacionesProyectadas)
      .set({ deletedAt: now, deletedBy: usuarioId, updatedAt: now, updatedBy: usuarioId })
      .where(
        and(
          eq(cubicacionesProyectadas.id, id),
          eq(cubicacionesProyectadas.tenantId, tenantId),
          isNull(cubicacionesProyectadas.deletedAt),
        ),
      )
      .returning();
    return updated;
  }

  async vincularCubicacionReal(
    tenantId: string,
    proyectadaId: string,
    cubicacionId: string,
    usuarioId: string,
  ) {
    const now = new Date();
    const [updated] = await this.db.tx
      .update(cubicacionesProyectadas)
      .set({ cubicacionId, updatedAt: now, updatedBy: usuarioId })
      .where(
        and(
          eq(cubicacionesProyectadas.id, proyectadaId),
          eq(cubicacionesProyectadas.tenantId, tenantId),
          isNull(cubicacionesProyectadas.deletedAt),
        ),
      )
      .returning();
    return updated;
  }

  // ── Proyecciones ──────────────────────────────────────────────────────────

  /**
   * Flujo de caja proyectado para un proyecto específico.
   *
   * Inflows:  CxC pendientes del proyecto + cubicaciones proyectadas sin vincular.
   * Outflows: OCs en estado EMITIDA (por línea → partida → proyecto)
   *           + programaciones de pago imputadas al proyecto.
   *
   * Saldo inicial = 0: muestra posición neta del proyecto, no la caja corporativa.
   * Para ver la posición corporativa real usar calcularFlujoConsolidado.
   */
  async calcularFlujoPorProyecto(
    tenantId: string,
    proyectoId: string,
    horizonte = 13,
  ): Promise<ResultadoFlujo> {
    const semanas = this.construirSemanas(horizonte);

    // ── Inflows ───────────────────────────────────────────────────────────────

    const cxcRows = await this.db.tx
      .select({
        id: cuentasPorCobrar.id,
        montoOriginal: cuentasPorCobrar.montoOriginal,
        montoCobrado: cuentasPorCobrar.montoCobrado,
        moneda: cuentasPorCobrar.moneda,
        fechaVencimiento: cuentasPorCobrar.fechaVencimiento,
        fechaEmision: cuentasPorCobrar.fechaEmision,
      })
      .from(cuentasPorCobrar)
      .where(
        and(
          eq(cuentasPorCobrar.tenantId, tenantId),
          eq(cuentasPorCobrar.proyectoId, proyectoId),
          inArray(cuentasPorCobrar.estado, ['PENDIENTE', 'PAGADA_PARCIAL']),
        ),
      );

    const proyectadasRows = await this.db.tx
      .select()
      .from(cubicacionesProyectadas)
      .where(
        and(
          eq(cubicacionesProyectadas.tenantId, tenantId),
          eq(cubicacionesProyectadas.proyectoId, proyectoId),
          isNull(cubicacionesProyectadas.cubicacionId),
          isNull(cubicacionesProyectadas.deletedAt),
        ),
      );

    // ── Outflows ──────────────────────────────────────────────────────────────

    // OCs EMITIDAS con al menos una línea en este proyecto.
    // Usamos una subconsulta en dos pasos para evitar duplicados por línea.
    const partidaRows = await this.db.tx
      .select({ id: partidas.id })
      .from(partidas)
      .where(
        and(
          eq(partidas.tenantId, tenantId),
          eq(partidas.proyectoId, proyectoId),
        ),
      );

    const inflowItems = this.construirInflowItems(cxcRows, proyectadasRows);
    const outflowItems: ItemFlujo[] = [];

    if (partidaRows.length > 0) {
      const pIds = partidaRows.map((p) => p.id);

      const ocLineaRows = await this.db.tx
        .selectDistinct({ ordenCompraId: lineasOrdenCompra.ordenCompraId })
        .from(lineasOrdenCompra)
        .where(inArray(lineasOrdenCompra.partidaId, pIds));

      const ocIds = ocLineaRows.map((r) => r.ordenCompraId);

      if (ocIds.length > 0) {
        const ocRows = await this.db.tx
          .select({
            id: ordenesCompra.id,
            numero: ordenesCompra.numero,
            totalMonto: ordenesCompra.totalMonto,
            moneda: ordenesCompra.moneda,
            fechaEntregaPrometida: ordenesCompra.fechaEntregaPrometida,
            fechaEmision: ordenesCompra.fechaEmision,
          })
          .from(ordenesCompra)
          .where(
            and(
              eq(ordenesCompra.tenantId, tenantId),
              eq(ordenesCompra.estado, 'EMITIDA'),
              inArray(ordenesCompra.id, ocIds),
            ),
          );

        for (const oc of ocRows) {
          outflowItems.push({
            tipo: 'OC_COMPROMETIDA',
            referenciaId: oc.id,
            referenciaTipo: 'orden_compra',
            descripcion: `OC ${oc.numero}`,
            monto: oc.totalMonto,
            moneda: oc.moneda,
            fechaEsperada:
              oc.fechaEntregaPrometida ??
              this.sumarDias(oc.fechaEmision ?? this.fechaISO(new Date()), 15),
          });
        }
      }
    }

    const pagosRows = await this.db.tx
      .select()
      .from(programacionesPago)
      .where(
        and(
          eq(programacionesPago.tenantId, tenantId),
          eq(programacionesPago.proyectoId, proyectoId),
          inArray(programacionesPago.estado, ['PROGRAMADO', 'EN_ESPERA']),
        ),
      );

    for (const p of pagosRows) {
      outflowItems.push({
        tipo: 'PAGO_PROGRAMADO',
        referenciaId: p.id,
        referenciaTipo: 'programacion_pago',
        descripcion: 'Pago programado',
        monto: p.monto,
        moneda: p.moneda,
        fechaEsperada: p.fechaProgramada,
      });
    }

    return this.armarResultado('0.0000', 'DOP', horizonte, semanas, inflowItems, outflowItems);
  }

  /**
   * Flujo de caja proyectado consolidado de una empresa.
   *
   * Saldo inicial real: suma de saldo_actual de cuentas bancarias DOP activas.
   * Outflows incluye todas las CxP pendientes (sin distinguir por proyecto).
   */
  async calcularFlujoConsolidado(
    tenantId: string,
    empresaId: string,
    horizonte = 13,
  ): Promise<ResultadoFlujo> {
    const semanas = this.construirSemanas(horizonte);

    // Saldo inicial real
    const cuentasRows = await this.db.tx
      .select({ saldo: cuentasBancarias.saldoActual })
      .from(cuentasBancarias)
      .where(
        and(
          eq(cuentasBancarias.tenantId, tenantId),
          eq(cuentasBancarias.empresaId, empresaId),
          eq(cuentasBancarias.activo, true),
          eq(cuentasBancarias.moneda, 'DOP'),
        ),
      );

    const saldoInicial = cuentasRows
      .reduce((acc, r) => acc.plus(r.saldo), new Decimal(0))
      .toFixed(4);

    // Inflows
    const cxcRows = await this.db.tx
      .select({
        id: cuentasPorCobrar.id,
        montoOriginal: cuentasPorCobrar.montoOriginal,
        montoCobrado: cuentasPorCobrar.montoCobrado,
        moneda: cuentasPorCobrar.moneda,
        fechaVencimiento: cuentasPorCobrar.fechaVencimiento,
        fechaEmision: cuentasPorCobrar.fechaEmision,
      })
      .from(cuentasPorCobrar)
      .where(
        and(
          eq(cuentasPorCobrar.tenantId, tenantId),
          eq(cuentasPorCobrar.empresaId, empresaId),
          inArray(cuentasPorCobrar.estado, ['PENDIENTE', 'PAGADA_PARCIAL']),
        ),
      );

    const proyectadasRows = await this.db.tx
      .select()
      .from(cubicacionesProyectadas)
      .where(
        and(
          eq(cubicacionesProyectadas.tenantId, tenantId),
          eq(cubicacionesProyectadas.empresaId, empresaId),
          isNull(cubicacionesProyectadas.cubicacionId),
          isNull(cubicacionesProyectadas.deletedAt),
        ),
      );

    // Outflows
    const cxpRows = await this.db.tx
      .select({
        id: cuentasPorPagar.id,
        montoOriginal: cuentasPorPagar.montoOriginal,
        montoPagado: cuentasPorPagar.montoPagado,
        moneda: cuentasPorPagar.moneda,
        fechaVencimiento: cuentasPorPagar.fechaVencimiento,
        createdAt: cuentasPorPagar.createdAt,
      })
      .from(cuentasPorPagar)
      .where(
        and(
          eq(cuentasPorPagar.tenantId, tenantId),
          eq(cuentasPorPagar.empresaId, empresaId),
          inArray(cuentasPorPagar.estado, ['PENDIENTE', 'PAGADA_PARCIAL']),
        ),
      );

    const pagosRows = await this.db.tx
      .select()
      .from(programacionesPago)
      .where(
        and(
          eq(programacionesPago.tenantId, tenantId),
          eq(programacionesPago.empresaId, empresaId),
          inArray(programacionesPago.estado, ['PROGRAMADO', 'EN_ESPERA']),
        ),
      );

    const inflowItems = this.construirInflowItems(cxcRows, proyectadasRows);

    const outflowItems: ItemFlujo[] = [
      ...cxpRows.map((r) => ({
        tipo: 'CXP_PENDIENTE' as TipoFlujo,
        referenciaId: r.id,
        referenciaTipo: 'cuenta_por_pagar',
        descripcion: 'CxP pendiente',
        monto: new Decimal(r.montoOriginal).minus(r.montoPagado).toFixed(4),
        moneda: r.moneda,
        fechaEsperada:
          r.fechaVencimiento ??
          this.fechaISO(new Date(r.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000)),
      })),
      ...pagosRows.map((r) => ({
        tipo: 'PAGO_PROGRAMADO' as TipoFlujo,
        referenciaId: r.id,
        referenciaTipo: 'programacion_pago',
        descripcion: 'Pago programado',
        monto: r.monto,
        moneda: r.moneda,
        fechaEsperada: r.fechaProgramada,
      })),
    ];

    return this.armarResultado(saldoInicial, 'DOP', horizonte, semanas, inflowItems, outflowItems);
  }

  // ── Helpers privados ──────────────────────────────────────────────────────

  private construirInflowItems(
    cxcRows: { id: string; montoOriginal: string; montoCobrado: string; moneda: string; fechaVencimiento: string | null; fechaEmision: string }[],
    proyectadasRows: { id: string; montoProyectado: string; moneda: string; descripcion: string | null; fechaProyectada: string }[],
  ): ItemFlujo[] {
    return [
      ...cxcRows.map((r) => ({
        tipo: 'CXC_PENDIENTE' as TipoFlujo,
        referenciaId: r.id,
        referenciaTipo: 'cuenta_por_cobrar',
        descripcion: 'CxC pendiente',
        monto: new Decimal(r.montoOriginal).minus(r.montoCobrado).toFixed(4),
        moneda: r.moneda,
        fechaEsperada: r.fechaVencimiento ?? this.sumarDias(r.fechaEmision, 30),
      })),
      ...proyectadasRows.map((r) => ({
        tipo: 'CXC_PROYECTADA' as TipoFlujo,
        referenciaId: r.id,
        referenciaTipo: 'cubicacion_proyectada',
        descripcion: r.descripcion ?? 'Cubicación proyectada',
        monto: r.montoProyectado,
        moneda: r.moneda,
        fechaEsperada: r.fechaProyectada,
      })),
    ];
  }

  private construirSemanas(horizonte: number): Pick<SemanaCaja, 'semana' | 'inicioSemana' | 'finSemana'>[] {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Array.from({ length: horizonte }, (_, i) => {
      const inicio = new Date(hoy.getTime() + i * 7 * 86_400_000);
      const fin = new Date(hoy.getTime() + (i + 1) * 7 * 86_400_000 - 1);
      return { semana: i + 1, inicioSemana: this.fechaISO(inicio), finSemana: this.fechaISO(fin) };
    });
  }

  private fechaISO(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private sumarDias(fechaISO: string, dias: number): string {
    const d = new Date(fechaISO + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  private asignarSemana(
    fechaISO: string,
    semanas: Pick<SemanaCaja, 'semana' | 'inicioSemana' | 'finSemana'>[],
  ): number | null {
    // Vencidos antes del horizonte → semana 1
    if (fechaISO < semanas[0]!.inicioSemana) return 1;
    for (const s of semanas) {
      if (fechaISO >= s.inicioSemana && fechaISO <= s.finSemana) return s.semana;
    }
    return null; // Fuera del horizonte
  }

  private armarResultado(
    saldoInicial: string,
    monedaBase: string,
    horizonte: number,
    semanas: Pick<SemanaCaja, 'semana' | 'inicioSemana' | 'finSemana'>[],
    inflowItems: ItemFlujo[],
    outflowItems: ItemFlujo[],
  ): ResultadoFlujo {
    const resultado: SemanaCaja[] = semanas.map((s) => ({
      ...s,
      inflows: [],
      outflows: [],
      totalInflows: '0.0000',
      totalOutflows: '0.0000',
      posicionNeta: '0.0000',
      posicionAcumulada: '0.0000',
      alertaDeficit: false,
    }));

    for (const item of inflowItems) {
      const n = this.asignarSemana(item.fechaEsperada, semanas);
      if (n !== null) resultado[n - 1]!.inflows.push(item);
    }
    for (const item of outflowItems) {
      const n = this.asignarSemana(item.fechaEsperada, semanas);
      if (n !== null) resultado[n - 1]!.outflows.push(item);
    }

    let acumulado = new Decimal(saldoInicial);
    for (const s of resultado) {
      const totalIn = s.inflows.reduce((a, i) => a.plus(i.monto), new Decimal(0));
      const totalOut = s.outflows.reduce((a, i) => a.plus(i.monto), new Decimal(0));
      const neta = totalIn.minus(totalOut);
      acumulado = acumulado.plus(neta);

      s.totalInflows = totalIn.toFixed(4);
      s.totalOutflows = totalOut.toFixed(4);
      s.posicionNeta = neta.toFixed(4);
      s.posicionAcumulada = acumulado.toFixed(4);
      s.alertaDeficit = acumulado.lt(0);
    }

    return { saldoInicial, moneda: monedaBase, horizonte, semanas: resultado };
  }
}
