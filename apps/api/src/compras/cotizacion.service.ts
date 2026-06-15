import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and, isNull } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type { CotizacionCreateInput } from '@tributia/compras';
import { DbService } from '../database/db.service.js';
import { cotizaciones, lineasCotizacion } from '../db/schema/compras/cotizacion.js';
import { solicitudesCotizacion, lineasSoc } from '../db/schema/compras/solicitud_cotizacion.js';
import { terceros } from '../db/schema/catalogos/tercero.js';

export interface CuadroComparativoItem {
  lineaSocId: string;
  descripcion: string;
  cantidad: string;
  unidadMedida: string;
  cotizaciones: {
    cotizacionId: string;
    terceroId: string;
    nombreProveedor: string;
    precioUnitario: string;
    total: string;
    plazoEntregaDias: number | null;
  }[];
  mejorPrecioTerceroId: string | null;
}

@Injectable()
export class CotizacionService {
  constructor(private readonly db: DbService) {}

  async registrar(tenantId: string, usuarioId: string, input: CotizacionCreateInput) {
    const now = new Date();

    // Verificar que la SOC existe y está ENVIADA
    const [soc] = await this.db.tx
      .select()
      .from(solicitudesCotizacion)
      .where(
        and(eq(solicitudesCotizacion.tenantId, tenantId), eq(solicitudesCotizacion.id, input.socId)),
      )
      .limit(1);

    if (!soc) throw new NotFoundException(`SOC ${input.socId} no encontrada.`);
    if (soc.estado !== 'ENVIADA') {
      throw new BadRequestException(`Solo se pueden registrar cotizaciones sobre SOCs en estado ENVIADA. Estado: ${soc.estado}`);
    }

    const [cot] = await this.db.tx
      .insert(cotizaciones)
      .values({
        id: newId(),
        tenantId,
        socId: input.socId,
        terceroId: input.terceroId,
        numeroCotizacionProveedor: input.numeroCotizacionProveedor ?? null,
        fechaEmision: input.fechaEmision ?? null,
        fechaValidez: input.fechaValidez ?? null,
        estado: 'RECIBIDA',
        condicionesPago: input.condicionesPago ?? null,
        notas: input.notas ?? null,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();

    for (const linea of input.lineas) {
      await this.db.tx.insert(lineasCotizacion).values({
        id: newId(),
        tenantId,
        cotizacionId: cot!.id,
        lineaSocId: linea.lineaSocId,
        precioUnitario: linea.precioUnitario,
        cantidad: linea.cantidad,
        total: linea.total,
        moneda: linea.moneda,
        plazoEntregaDias: linea.plazoEntregaDias ?? null,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      });
    }

    return cot!;
  }

  /**
   * Cuadro comparativo: para cada línea de la SOC, muestra las cotizaciones recibidas
   * de todos los proveedores con precio, plazo e historial. Marca el mejor precio.
   */
  async getCuadroComparativo(tenantId: string, socId: string): Promise<CuadroComparativoItem[]> {
    const [soc] = await this.db.tx
      .select()
      .from(solicitudesCotizacion)
      .where(and(eq(solicitudesCotizacion.tenantId, tenantId), eq(solicitudesCotizacion.id, socId)))
      .limit(1);

    if (!soc) throw new NotFoundException(`SOC ${socId} no encontrada.`);

    const lineasSocRows = await this.db.tx
      .select()
      .from(lineasSoc)
      .where(eq(lineasSoc.socId, socId));

    const cotizacionesSoc = await this.db.tx
      .select({
        cotizacion: cotizaciones,
        linea: lineasCotizacion,
        tercero: terceros,
      })
      .from(cotizaciones)
      .innerJoin(lineasCotizacion, eq(lineasCotizacion.cotizacionId, cotizaciones.id))
      .innerJoin(terceros, eq(terceros.id, cotizaciones.terceroId))
      .where(
        and(
          eq(cotizaciones.tenantId, tenantId),
          eq(cotizaciones.socId, socId),
          isNull(cotizaciones.deletedAt),
        ),
      );

    return lineasSocRows.map((lineaSoc) => {
      const cotizacionesLinea = cotizacionesSoc.filter(
        (c) => c.linea.lineaSocId === lineaSoc.id,
      );

      let mejorPrecioTerceroId: string | null = null;
      let mejorPrecio: Decimal | null = null;

      const cotizacionesData = cotizacionesLinea.map((c) => {
        const precio = new Decimal(c.linea.precioUnitario);
        if (mejorPrecio === null || precio.lessThan(mejorPrecio)) {
          mejorPrecio = precio;
          mejorPrecioTerceroId = c.cotizacion.terceroId;
        }
        return {
          cotizacionId: c.cotizacion.id,
          terceroId: c.cotizacion.terceroId,
          nombreProveedor: c.tercero.nombreComercial,
          precioUnitario: c.linea.precioUnitario,
          total: c.linea.total,
          plazoEntregaDias: c.linea.plazoEntregaDias,
        };
      });

      return {
        lineaSocId: lineaSoc.id,
        descripcion: lineaSoc.descripcion,
        cantidad: lineaSoc.cantidad,
        unidadMedida: lineaSoc.unidadMedida,
        cotizaciones: cotizacionesData,
        mejorPrecioTerceroId,
      };
    });
  }

  async seleccionar(tenantId: string, usuarioId: string, cotizacionId: string) {
    const [cot] = await this.db.tx
      .select()
      .from(cotizaciones)
      .where(and(eq(cotizaciones.tenantId, tenantId), eq(cotizaciones.id, cotizacionId)))
      .limit(1);

    if (!cot) throw new NotFoundException(`Cotización ${cotizacionId} no encontrada.`);

    const now = new Date();
    const [updated] = await this.db.tx
      .update(cotizaciones)
      .set({ estado: 'SELECCIONADA', updatedAt: now, updatedBy: usuarioId })
      .where(eq(cotizaciones.id, cotizacionId))
      .returning();

    return updated!;
  }

  async findAll(tenantId: string, socId?: string) {
    return this.db.tx
      .select()
      .from(cotizaciones)
      .where(
        and(
          eq(cotizaciones.tenantId, tenantId),
          socId ? eq(cotizaciones.socId, socId) : undefined,
          isNull(cotizaciones.deletedAt),
        ),
      );
  }

  async findById(tenantId: string, id: string) {
    const [cot] = await this.db.tx
      .select()
      .from(cotizaciones)
      .where(and(eq(cotizaciones.tenantId, tenantId), eq(cotizaciones.id, id)))
      .limit(1);

    if (!cot) throw new NotFoundException(`Cotización ${id} no encontrada.`);

    const lineas = await this.db.tx
      .select()
      .from(lineasCotizacion)
      .where(eq(lineasCotizacion.cotizacionId, id));

    return { ...cot, lineas };
  }
}
