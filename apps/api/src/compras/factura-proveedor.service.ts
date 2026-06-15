import { Injectable, BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from '@tributia/shared';
import Decimal from 'decimal.js';
import { validarEcf } from '@tributia/localizacion-do';
import { LedgerService } from '../ledger/ledger.service.js';
import { DbService } from '../database/db.service.js';
import {
  facturasProveedor,
  lineasFacturaProveedor,
  type EstadoMatch,
} from '../db/schema/compras/factura_proveedor.js';
import { lineasOrdenCompra } from '../db/schema/compras/orden_compra.js';
import { lineasRecepcionOc } from '../db/schema/compras/recepcion_oc.js';
import { terceros } from '../db/schema/catalogos/tercero.js';

const zUUID = z.string().uuid();
const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const zFacturaProveedorCreate = z.object({
  empresaId: zUUID,
  terceroId: zUUID,
  rncProveedor: z.string().min(9).max(13),
  ordenCompraId: zUUID.nullable().optional(),
  recepcionOcId: zUUID.nullable().optional(),
  numero: z.string().min(1).max(30),
  ncf: z.string().min(11).max(19),
  fechaFactura: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fechaEmisionEcf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  fechaVencimientoPago: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  montoSubtotal: zDecimal,
  montoItbis: zDecimal,
  montoTotal: zDecimal,
  moneda: z.enum(['DOP', 'USD', 'EUR']).default('DOP'),
  toleranciaPrecioPct: zDecimal.optional(),
  toleranciaCantidadPct: zDecimal.optional(),
  lineas: z
    .array(
      z.object({
        lineaOrdenCompraId: zUUID.nullable().optional(),
        descripcion: z.string().min(1).max(500),
        cantidad: zDecimal,
        precioUnitario: zDecimal,
        itbis: zDecimal.optional(),
        total: zDecimal,
        moneda: z.enum(['DOP', 'USD', 'EUR']).default('DOP'),
      }),
    )
    .min(1),
  notas: z.string().max(1000).optional(),
});

export type FacturaProveedorCreateDto = z.infer<typeof zFacturaProveedorCreate>;

interface LineaMatchOc {
  id: string;
  cantidad: string;
  precioUnitario: string;
}
interface LineaMatchRecepcion {
  lineaOrdenCompraId: string;
  cantidadRecibida: string;
  costoUnitario: string;
}
interface LineaMatchFactura {
  lineaOrdenCompraId?: string | null | undefined;
  cantidad: string;
  precioUnitario: string;
}

type MatchResult =
  | 'OK'
  | 'DISCREPANCIA_PRECIO'
  | 'DISCREPANCIA_CANTIDAD'
  | 'PENDIENTE';

export function calcularMatch(
  lineasOc: LineaMatchOc[],
  lineasRecepcion: LineaMatchRecepcion[],
  lineasFactura: LineaMatchFactura[],
  toleranciaPrecioPct: string,
  toleranciaCantidadPct: string,
): MatchResult {
  if (lineasOc.length === 0) return 'PENDIENTE';

  const tolPrecio = new Decimal(toleranciaPrecioPct).div(100);
  const tolCantidad = new Decimal(toleranciaCantidadPct).div(100);

  for (const lineaOc of lineasOc) {
    const lineaRec = lineasRecepcion.find(
      (r) => r.lineaOrdenCompraId === lineaOc.id,
    );
    const lineaFact = lineasFactura.find(
      (f) => f.lineaOrdenCompraId === lineaOc.id,
    );

    if (!lineaRec || !lineaFact) continue;

    const cantOc = new Decimal(lineaOc.cantidad);
    const cantRec = new Decimal(lineaRec.cantidadRecibida);
    const cantFact = new Decimal(lineaFact.cantidad);

    const precioOc = new Decimal(lineaOc.precioUnitario);
    const precioFact = new Decimal(lineaFact.precioUnitario);

    // Verificar discrepancia de precio
    if (!precioOc.isZero()) {
      const diffPrecio = precioFact.minus(precioOc).abs().div(precioOc);
      if (diffPrecio.gt(tolPrecio)) {
        return 'DISCREPANCIA_PRECIO';
      }
    }

    // Verificar discrepancia de cantidad (factura vs recepción)
    if (!cantRec.isZero()) {
      const diffCantidad = cantFact.minus(cantRec).abs().div(cantRec);
      if (diffCantidad.gt(tolCantidad)) {
        return 'DISCREPANCIA_CANTIDAD';
      }
    }

    // También comparar cantFact vs cantOc (factura no puede exceder OC en más de tolerancia)
    if (!cantOc.isZero()) {
      const diffVsOc = cantFact.minus(cantOc).abs().div(cantOc);
      if (diffVsOc.gt(tolCantidad)) {
        return 'DISCREPANCIA_CANTIDAD';
      }
    }
  }

  return 'OK';
}

@Injectable()
export class FacturaProveedorService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  async registrar(
    tenantId: string,
    dto: FacturaProveedorCreateDto,
    usuarioId: string,
  ) {
    // ── 1. Validar e-CF ──────────────────────────────────────────────────────
    const ecfInput: import('@tributia/localizacion-do').EcfValidationInput = dto.fechaEmisionEcf
      ? { ncf: dto.ncf, rncProveedor: dto.rncProveedor, fechaEmision: new Date(dto.fechaEmisionEcf) }
      : { ncf: dto.ncf, rncProveedor: dto.rncProveedor };
    const ecfResult = validarEcf(ecfInput);

    if (!ecfResult.valido) {
      throw new UnprocessableEntityException({
        mensaje: 'e-CF inválido — la factura no puede ser aceptada a CxP',
        errores: ecfResult.errores,
      });
    }

    // ── 2. Cargar líneas de OC para el match ─────────────────────────────────
    let lineasOc: LineaMatchOc[] = [];
    let lineasRec: LineaMatchRecepcion[] = [];

    if (dto.ordenCompraId) {
      lineasOc = await this.db.tx
        .select({
          id: lineasOrdenCompra.id,
          cantidad: lineasOrdenCompra.cantidad,
          precioUnitario: lineasOrdenCompra.precioUnitario,
        })
        .from(lineasOrdenCompra)
        .where(
          and(
            eq(lineasOrdenCompra.ordenCompraId, dto.ordenCompraId),
            eq(lineasOrdenCompra.tenantId, tenantId),
          ),
        );
    }

    if (dto.recepcionOcId) {
      lineasRec = await this.db.tx
        .select({
          lineaOrdenCompraId: lineasRecepcionOc.lineaOrdenCompraId,
          cantidadRecibida: lineasRecepcionOc.cantidadRecibida,
          costoUnitario: lineasRecepcionOc.costoUnitario,
        })
        .from(lineasRecepcionOc)
        .where(
          and(
            eq(lineasRecepcionOc.recepcionOcId, dto.recepcionOcId),
            eq(lineasRecepcionOc.tenantId, tenantId),
          ),
        );
    }

    // ── 3. Calcular match de 3 vías ──────────────────────────────────────────
    const lineasFacturaMatch: LineaMatchFactura[] = dto.lineas.map((l) => ({
      lineaOrdenCompraId: l.lineaOrdenCompraId,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
    }));

    const estadoMatch: EstadoMatch =
      lineasOc.length > 0
        ? calcularMatch(
            lineasOc,
            lineasRec,
            lineasFacturaMatch,
            dto.toleranciaPrecioPct ?? '2.00',
            dto.toleranciaCantidadPct ?? '5.00',
          )
        : 'PENDIENTE';

    // ── 4. Persistir factura + líneas ────────────────────────────────────────
    const facturaId = newId();
    const now = new Date();

    await this.db.tx.insert(facturasProveedor).values({
      id: facturaId,
      tenantId,
      empresaId: dto.empresaId,
      terceroId: dto.terceroId,
      ordenCompraId: dto.ordenCompraId ?? null,
      recepcionOcId: dto.recepcionOcId ?? null,
      numero: dto.numero,
      ncf: dto.ncf.trim().toUpperCase(),
      tipoEcf: ecfResult.tipoDetectado ?? null,
      ecfValidado: true,
      fechaFactura: dto.fechaFactura,
      fechaVencimientoPago: dto.fechaVencimientoPago ?? null,
      montoSubtotal: dto.montoSubtotal,
      montoItbis: dto.montoItbis,
      montoTotal: dto.montoTotal,
      moneda: dto.moneda,
      estadoMatch,
      toleranciaPrecioPct: dto.toleranciaPrecioPct ?? '2.00',
      toleranciaCantidadPct: dto.toleranciaCantidadPct ?? '5.00',
      estadoCxp: 'PENDIENTE',
      notas: dto.notas ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    });

    for (const linea of dto.lineas) {
      await this.db.tx.insert(lineasFacturaProveedor).values({
        id: newId(),
        tenantId,
        facturaProveedorId: facturaId,
        lineaOrdenCompraId: linea.lineaOrdenCompraId ?? null,
        descripcion: linea.descripcion,
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        itbis: linea.itbis ?? '0.0000',
        total: linea.total,
        moneda: linea.moneda,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      });
    }

    // ── 5. Emitir evento → handler crea asiento + CxP ─────────────────────
    // Derivar proyectoId desde la OC si está vinculada; de lo contrario null
    let proyectoId: string | null = null;
    if (dto.ordenCompraId && lineasOc.length > 0) {
      // proyectoId se derivará dentro del handler via la OC — aquí lo dejamos null
      // y el handler lo infiere del recepcion_oc → orden_compra → partida → proyecto
    }

    const evento = await this.ledger.append({
      tenantId,
      empresaId: dto.empresaId,
      proyectoId: proyectoId ?? '',
      centroCostoId: null,
      tipoEvento: 'recepcion_factura_proveedor',
      usuarioId,
      payload: {
        proveedorId: dto.terceroId,
        ncf: dto.ncf.trim().toUpperCase(),
        montoSubtotal: { amount: dto.montoSubtotal, currency: dto.moneda },
        montoItbis: { amount: dto.montoItbis, currency: dto.moneda },
        montoTotal: { amount: dto.montoTotal, currency: dto.moneda },
        ordenCompraId: dto.ordenCompraId ?? null,
        recepcionMaterialEventoId: null,
      },
      referenciaId: facturaId,
      referenciaTabla: 'factura_proveedor',
      idempotencyKey: `recepcion_factura_proveedor:${facturaId}`,
    });

    // Actualizar factura con el eventoId
    await this.db.tx
      .update(facturasProveedor)
      .set({ eventoId: evento.id, updatedAt: new Date(), updatedBy: usuarioId })
      .where(eq(facturasProveedor.id, facturaId));

    return {
      id: facturaId,
      estadoMatch,
      ecfValidado: true,
      tipoEcf: ecfResult.tipoDetectado,
      advertencias: ecfResult.advertencias,
      eventoId: evento.id,
    };
  }

  async aprobarExcepcion(tenantId: string, facturaId: string, usuarioId: string) {
    const [factura] = await this.db.tx
      .select()
      .from(facturasProveedor)
      .where(
        and(eq(facturasProveedor.id, facturaId), eq(facturasProveedor.tenantId, tenantId)),
      )
      .limit(1);

    if (!factura) throw new NotFoundException('Factura no encontrada');

    const estadosDiscrepancia: EstadoMatch[] = [
      'DISCREPANCIA_PRECIO',
      'DISCREPANCIA_CANTIDAD',
    ];
    if (!estadosDiscrepancia.includes(factura.estadoMatch as EstadoMatch)) {
      throw new BadRequestException(
        `Solo se puede aprobar excepción en estado DISCREPANCIA_*. Estado actual: ${factura.estadoMatch}`,
      );
    }

    await this.db.tx
      .update(facturasProveedor)
      .set({
        estadoMatch: 'EXCEPCION_APROBADA',
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(facturasProveedor.id, facturaId));

    return { id: facturaId, estadoMatch: 'EXCEPCION_APROBADA' };
  }

  async findAll(tenantId: string, empresaId?: string) {
    return this.db.tx
      .select()
      .from(facturasProveedor)
      .where(
        and(
          eq(facturasProveedor.tenantId, tenantId),
          empresaId ? eq(facturasProveedor.empresaId, empresaId) : undefined,
          isNull(facturasProveedor.deletedAt),
        ),
      );
  }

  async findById(tenantId: string, id: string) {
    const [factura] = await this.db.tx
      .select()
      .from(facturasProveedor)
      .where(
        and(eq(facturasProveedor.id, id), eq(facturasProveedor.tenantId, tenantId)),
      )
      .limit(1);

    if (!factura) throw new NotFoundException(`Factura ${id} no encontrada`);

    const lineas = await this.db.tx
      .select()
      .from(lineasFacturaProveedor)
      .where(eq(lineasFacturaProveedor.facturaProveedorId, id));

    return { ...factura, lineas };
  }
}
