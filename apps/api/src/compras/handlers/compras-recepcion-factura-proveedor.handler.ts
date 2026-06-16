import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { zPayloadRecepcionFacturaProveedor } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { cuentasPorPagar } from '../../db/schema/compras/cuenta_por_pagar.js';
import { facturasProveedor } from '../../db/schema/compras/factura_proveedor.js';
import { scoringProveedor } from '../../db/schema/compras/scoring_proveedor.js';
import { eq, and } from 'drizzle-orm';
import { ReglaContableService } from '../../contabilidad/regla-contable.service.js';
import { AsientoContableService } from '../../contabilidad/asiento-contable.service.js';

/**
 * Handler SÍNCRONO para el evento recepcion_factura_proveedor.
 *
 * Dentro de la misma transacción:
 *   1. Genera el asiento contable:
 *        DEBE  1104.XX  Inventario / Costo de Obra
 *        HABER 2101.XX  Cuentas por Pagar Proveedores
 *   2. Crea la cuenta_por_pagar vinculada a la factura
 *   3. Actualiza scoring: penaliza discrepancias de precio si las hay
 *
 * Si no existe regla contable configurada: avisa por log y crea la CxP
 * igual (el asiento puede ser generado manualmente después).
 */
@Injectable()
export class ComprasRecepcionFacturaProveedorHandler implements ProjectionHandler {
  readonly nombre = 'ComprasRecepcionFacturaProveedor';
  readonly tiposEvento = ['recepcion_factura_proveedor'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadRecepcionFacturaProveedor.parse(evento.payload);
    const now = new Date();
    const montoTotal = new Decimal(payload.montoTotal.amount);

    // ── 1. Generar asiento contable si hay regla configurada ─────────────────
    let asientoId: string | null = null;

    const regla = await this.reglaService.findByTipoEvento(
      tx,
      evento.empresaId,
      'recepcion_factura_proveedor',
    );

    if (regla) {
      const config = regla.configuracion;
      const lineas = config.lineas.map(
        (lr: { cuentaCodigo: string; tipo: 'debito' | 'credito'; descripcion?: string }) => ({
          cuentaCodigo: lr.cuentaCodigo,
          tipo: lr.tipo === 'debito' ? ('debe' as const) : ('haber' as const),
          importe: montoTotal.toFixed(4),
          moneda: payload.montoTotal.currency,
          ...(lr.descripcion ? { descripcion: lr.descripcion } : {}),
        }),
      );

      const asiento = await this.asientoService.generar(
        {
          tenantId: evento.tenantId,
          empresaId: evento.empresaId,
          tipo: 'automatico',
          eventoId: evento.id,
          reglaId: regla.id,
          fecha: new Date(evento.ocurridoEn).toISOString().slice(0, 10),
          descripcion: `Factura proveedor ${payload.ncf} — ${payload.proveedorId.slice(0, 8)}`,
          lineas,
          usuarioId: evento.createdBy,
        },
        tx,
      );
      asientoId = asiento.id;
    } else {
      throw new Error(
        `Regla contable requerida para 'recepcion_factura_proveedor' no encontrada en empresa ${evento.empresaId}. Configure la regla antes de registrar facturas de proveedor.`,
      );
    }

    // ── 2. Crear cuenta_por_pagar ─────────────────────────────────────────────
    // Buscar la factura_proveedor por evento_id para obtener su id y fecha vencimiento
    const [factura] = await tx
      .select()
      .from(facturasProveedor)
      .where(eq(facturasProveedor.eventoId, evento.id))
      .limit(1);

    const cxpId = newId();
    await tx.insert(cuentasPorPagar).values({
      id: cxpId,
      tenantId: evento.tenantId,
      empresaId: evento.empresaId,
      facturaProveedorId: factura?.id ?? newId(), // fallback si no hay factura registrada
      terceroId: payload.proveedorId,
      montoOriginal: montoTotal.toFixed(4),
      montoPagado: '0.0000',
      moneda: payload.montoTotal.currency,
      fechaVencimiento: factura?.fechaVencimientoPago ?? null,
      estado: 'PENDIENTE',
      eventoOrigenId: evento.id,
      asientoId: asientoId ?? null,
      createdAt: now,
      createdBy: evento.createdBy,
      updatedAt: now,
      updatedBy: evento.createdBy,
    });

    // ── 3. Actualizar scoring: discrepancias de precio ────────────────────────
    if (factura?.estadoMatch === 'DISCREPANCIA_PRECIO') {
      const [score] = await tx
        .select()
        .from(scoringProveedor)
        .where(
          and(
            eq(scoringProveedor.tenantId, evento.tenantId),
            eq(scoringProveedor.terceroId, payload.proveedorId),
          ),
        )
        .limit(1);

      if (score) {
        const totalDisc = score.totalDiscrepanciasPrecio + 1;
        const totalRec = score.totalRecepciones || 1;
        // Score precio = (1 - discrepancias/recepciones) * 100
        const scorePrecio = Decimal.max(
          new Decimal(0),
          new Decimal(1).minus(new Decimal(totalDisc).div(totalRec)).mul(100),
        ).toFixed(2);

        const scoreTotal = new Decimal(score.scorePuntualidad)
          .mul('0.4')
          .plus(new Decimal(score.scoreCalidad).mul('0.4'))
          .plus(new Decimal(scorePrecio).mul('0.2'))
          .toFixed(2);

        await tx
          .update(scoringProveedor)
          .set({
            totalDiscrepanciasPrecio: totalDisc,
            scorePrecio,
            scoreTotal,
            ultimaActualizacion: now,
            updatedAt: now,
            updatedBy: evento.createdBy,
          })
          .where(eq(scoringProveedor.id, score.id));
      }
    }
  }
}
