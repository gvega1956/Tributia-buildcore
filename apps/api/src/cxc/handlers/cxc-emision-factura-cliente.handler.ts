import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { zPayloadEmisionFacturaCliente } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import type { ProjectionHandler, ProjectionContext } from '../../ledger/projection.types.js';
import { cuentasPorCobrar } from '../../db/schema/cxc/cuenta_por_cobrar.js';
import { ReglaContableService } from '../../contabilidad/regla-contable.service.js';
import { AsientoContableService } from '../../contabilidad/asiento-contable.service.js';

/**
 * Handler SÍNCRONO para el evento emision_factura_cliente (§16).
 *
 * Dentro de la misma transacción:
 *   1. Genera el asiento contable (montos distintos por línea vía montoKey):
 *        DEBE  1102.XX  Cuentas por Cobrar Clientes (neto a cobrar)
 *        DEBE  1105.XX  Retención ISR por cobrar (si aplica, anticipo de impuesto)
 *        DEBE  1106.XX  Retención ITBIS por cobrar (si aplica)
 *        HABER 4101.XX  Ingresos por Servicios de Construcción (subtotal)
 *        HABER 2102.XX  ITBIS por Pagar (si aplica)
 *   2. Crea la cuenta_por_cobrar por el monto neto a cobrar (lo que el
 *      cliente efectivamente debe pagar en efectivo/transferencia).
 *
 * REQUERIDO (ADR-0005 + tipos-evento-requerido.ts): sin regla configurada,
 * el evento falla de forma visible — no hay asiento "fantasma" para CxC.
 */
@Injectable()
export class CxcEmisionFacturaClienteHandler implements ProjectionHandler {
  readonly nombre = 'CxcEmisionFacturaCliente';
  readonly tiposEvento = ['emision_factura_cliente'] as const;
  readonly modo = 'sincrono' as const;

  constructor(
    private readonly reglaService: ReglaContableService,
    private readonly asientoService: AsientoContableService,
  ) {}

  async ejecutar({ evento, tx }: ProjectionContext): Promise<void> {
    const payload = zPayloadEmisionFacturaCliente.parse(evento.payload);
    const now = new Date();
    const moneda = payload.montoTotal.currency;

    const montos: Record<string, Decimal> = {
      subtotal: new Decimal(payload.montoSubtotal.amount),
      itbis: new Decimal(payload.montoItbis.amount),
      retencionIsr: new Decimal(payload.montoRetencionIsr.amount),
      retencionItbis: new Decimal(payload.montoRetencionItbis.amount),
      netoACobrar: new Decimal(payload.montoNetoACobrar.amount),
    };

    const regla = await this.reglaService.findByTipoEvento(tx, evento.empresaId, 'emision_factura_cliente');

    if (!regla) {
      throw new Error(
        `Regla contable requerida para 'emision_factura_cliente' no encontrada en empresa ${evento.empresaId}. ` +
          `Configure la regla antes de emitir facturas a clientes.`,
      );
    }

    const config = regla.configuracion;
    const lineas = config.lineas
      .filter((lr: { montoKey?: string }) => {
        if (!lr.montoKey) return true;
        const monto = montos[lr.montoKey];
        return monto ? !monto.isZero() : false;
      })
      .map((lr: { cuentaCodigo: string; tipo: 'debito' | 'credito'; descripcion?: string; montoKey?: string }) => {
        const importe = lr.montoKey ? montos[lr.montoKey]! : montos.subtotal!;
        return {
          cuentaCodigo: lr.cuentaCodigo,
          tipo: lr.tipo === 'debito' ? ('debe' as const) : ('haber' as const),
          importe: importe.toFixed(4),
          moneda,
          ...(lr.descripcion ? { descripcion: lr.descripcion } : {}),
        };
      });

    if (!evento.proyectoId) {
      throw new Error(
        `Evento 'emision_factura_cliente' (${evento.id}) sin proyectoId: la facturacion a cliente siempre se imputa a un proyecto, nunca a un centro de costo administrativo.`,
      );
    }

    const asiento = await this.asientoService.generar(
      {
        tenantId: evento.tenantId,
        empresaId: evento.empresaId,
        tipo: 'automatico',
        eventoId: evento.id,
        reglaId: regla.id,
        fecha: payload.fechaEmision,
        descripcion: `Factura a cliente — cubicación ${payload.cubicacionId.slice(0, 8)}`,
        lineas,
        usuarioId: evento.createdBy,
      },
      tx,
    );

    await tx.insert(cuentasPorCobrar).values({
      id: newId(),
      tenantId: evento.tenantId,
      empresaId: evento.empresaId,
      proyectoId: evento.proyectoId,
      facturaClienteId: payload.facturaClienteId,
      terceroId: payload.clienteId,
      montoOriginal: montos.netoACobrar!.toFixed(4),
      montoCobrado: '0.0000',
      moneda,
      fechaEmision: payload.fechaEmision,
      fechaVencimiento: payload.fechaVencimiento,
      estado: 'PENDIENTE',
      eventoOrigenId: evento.id,
      asientoId: asiento.id,
      createdAt: now,
      createdBy: evento.createdBy,
      updatedAt: now,
      updatedBy: evento.createdBy,
    });
  }
}
