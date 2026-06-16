import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { newId, zUUID } from '@tributia/shared';
import {
  esAjusteEcf,
  construirComprobanteEcf,
  construirNcf,
  calcularHashIntegridad,
  calcularFechaLimiteRetencion,
  generarRepresentacionImpresa,
  type EcfDocumento,
  type EcfReceptor,
  type EcfReferenciaOrigen,
  type IMiddlewareEcfClient,
} from '@tributia/localizacion-do';
import { DbService } from '../database/db.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CatalogoDgiiService } from '../catalogos/catalogo-dgii.service.js';
import { comprobantesEcf } from '../db/schema/localizacion-do/comprobante_ecf.js';
import { acusesEcf } from '../db/schema/localizacion-do/acuse_ecf.js';
import { configuracionesEmisorEcf } from '../db/schema/localizacion-do/configuracion_emisor_ecf.js';
import { secuenciasEcf } from '../db/schema/localizacion-do/secuencia_ecf.js';
import { facturasCliente } from '../db/schema/cxc/factura_cliente.js';
import { terceros } from '../db/schema/catalogos/tercero.js';
import { MIDDLEWARE_ECF_CLIENT } from './middleware-ecf-client.token.js';

export const zEmisionEcfDto = z.object({
  tipo: z.enum(['E31', 'E32', 'E33', 'E34']),
  // Requerido para 31/32: factura del cliente que origina el e-CF.
  facturaClienteId: zUUID.optional(),
  // Requerido para 33/34: e-CF que el ajuste modifica.
  comprobanteOrigenId: zUUID.optional(),
  motivoAjuste: z.string().min(1).max(500).optional(),
  montoSubtotal: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
  montoItbis: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
});

export type EmisionEcfDto = z.infer<typeof zEmisionEcfDto>;

/**
 * EmisionEcfService — orquesta la emisión de e-CF de venta (ADR-0007).
 *
 * Toda la lógica fiscal (estructura del documento, NCF, hash, contingencia/RI,
 * retención documental) vive en @tributia/localizacion-do — pura, sin I/O.
 * Esta clase solo: valida contra el catálogo DGII vigente, resuelve los datos
 * de negocio (factura del cliente o e-CF de origen), asigna el número de
 * secuencia de forma atómica, transmite vía el puerto del middleware
 * (IMiddlewareEcfClient) y persiste comprobante + acuse en la misma transacción
 * del evento `emision_ecf`.
 */
@Injectable()
export class EmisionEcfService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly catalogoDgii: CatalogoDgiiService,
    @Inject(MIDDLEWARE_ECF_CLIENT) private readonly middleware: IMiddlewareEcfClient,
  ) {}

  async emitir(tenantId: string, dto: EmisionEcfDto, usuarioId: string) {
    const tipoVigente = await this.catalogoDgii.tipoEcfVigente(dto.tipo);
    if (!tipoVigente) {
      throw new BadRequestException(`Tipo de e-CF ${dto.tipo} no está vigente en el catálogo DGII`);
    }

    const esAjuste = esAjusteEcf(dto.tipo);

    let empresaId: string;
    let proyectoId: string;
    let moneda: string;
    let montoSubtotal: Decimal;
    let montoItbis: Decimal;
    let receptor: EcfReceptor;
    let facturaClienteId: string | null = null;
    let comprobanteOrigenId: string | null = null;
    let referenciaOrigen: EcfReferenciaOrigen | undefined;

    if (esAjuste) {
      if (!dto.comprobanteOrigenId) {
        throw new BadRequestException(`e-CF tipo ${dto.tipo} requiere comprobanteOrigenId`);
      }
      if (!dto.motivoAjuste) {
        throw new BadRequestException(`e-CF tipo ${dto.tipo} requiere motivoAjuste`);
      }
      if (!dto.montoSubtotal) {
        throw new BadRequestException(`e-CF tipo ${dto.tipo} requiere montoSubtotal`);
      }

      const [origen] = await this.db.tx
        .select()
        .from(comprobantesEcf)
        .where(and(eq(comprobantesEcf.id, dto.comprobanteOrigenId), eq(comprobantesEcf.tenantId, tenantId)))
        .limit(1);
      if (!origen) {
        throw new NotFoundException(`Comprobante e-CF origen ${dto.comprobanteOrigenId} no encontrado`);
      }

      const documentoOrigen = origen.documento as EcfDocumento;
      empresaId = origen.empresaId;
      proyectoId = origen.proyectoId;
      moneda = origen.moneda;
      montoSubtotal = new Decimal(dto.montoSubtotal);
      montoItbis = new Decimal(dto.montoItbis ?? '0');
      receptor = documentoOrigen.receptor;
      comprobanteOrigenId = origen.id;
      referenciaOrigen = {
        ncfOrigen: origen.ncf,
        fechaEmisionOrigen: origen.fechaEmision,
        montoOrigen: { amount: origen.montoTotal, currency: origen.moneda },
      };
    } else {
      if (!dto.facturaClienteId) {
        throw new BadRequestException(`e-CF tipo ${dto.tipo} requiere facturaClienteId`);
      }

      const [factura] = await this.db.tx
        .select()
        .from(facturasCliente)
        .where(and(eq(facturasCliente.id, dto.facturaClienteId), eq(facturasCliente.tenantId, tenantId)))
        .limit(1);
      if (!factura) throw new NotFoundException(`Factura cliente ${dto.facturaClienteId} no encontrada`);
      if (factura.ncf) throw new BadRequestException('Esta factura ya tiene un e-CF emitido');

      const [cliente] = await this.db.tx
        .select()
        .from(terceros)
        .where(and(eq(terceros.id, factura.clienteId), eq(terceros.tenantId, tenantId)))
        .limit(1);
      if (!cliente) throw new NotFoundException(`Cliente ${factura.clienteId} no encontrado`);

      empresaId = factura.empresaId;
      proyectoId = factura.proyectoId;
      moneda = factura.moneda;
      montoSubtotal = new Decimal(factura.montoSubtotal);
      montoItbis = new Decimal(factura.montoItbis);
      receptor = { rncOCedula: cliente.rncCedula, razonSocial: cliente.nombreComercial };
      facturaClienteId = factura.id;
    }

    const [configEmisor] = await this.db.tx
      .select()
      .from(configuracionesEmisorEcf)
      .where(
        and(
          eq(configuracionesEmisorEcf.tenantId, tenantId),
          eq(configuracionesEmisorEcf.empresaId, empresaId),
          eq(configuracionesEmisorEcf.activo, true),
        ),
      )
      .limit(1);
    if (!configEmisor) {
      throw new BadRequestException(`La empresa ${empresaId} no tiene configuración de emisor e-CF activa`);
    }

    const [secuencia] = await this.db.tx
      .update(secuenciasEcf)
      .set({ proximoNumero: sql`${secuenciasEcf.proximoNumero} + 1`, updatedAt: new Date(), updatedBy: usuarioId })
      .where(
        and(
          eq(secuenciasEcf.tenantId, tenantId),
          eq(secuenciasEcf.empresaId, empresaId),
          eq(secuenciasEcf.tipoEcf, dto.tipo),
        ),
      )
      .returning();
    if (!secuencia) {
      throw new BadRequestException(`No hay secuencia de NCF configurada para ${dto.tipo} en esta empresa`);
    }

    const numeroAsignado = secuencia.proximoNumero - 1;
    if (secuencia.rangoAutorizadoHasta != null && numeroAsignado > secuencia.rangoAutorizadoHasta) {
      throw new BadRequestException(
        `Se agotó el rango de NCF autorizado para ${dto.tipo} (hasta ${secuencia.rangoAutorizadoHasta})`,
      );
    }

    const ncf = construirNcf(dto.tipo, numeroAsignado);
    const ahora = new Date();
    const fechaEmision = ahora.toISOString().slice(0, 10);
    const montoTotal = montoSubtotal.plus(montoItbis);

    const documento = construirComprobanteEcf({
      tipo: dto.tipo,
      ncf,
      ambiente: configEmisor.ambiente,
      rncEmisor: configEmisor.rncEmisor,
      razonSocialEmisor: configEmisor.razonSocialEmisor,
      fechaEmision,
      receptor,
      montoSubtotal: { amount: montoSubtotal.toFixed(4), currency: moneda },
      montoItbis: { amount: montoItbis.toFixed(4), currency: moneda },
      montoTotal: { amount: montoTotal.toFixed(4), currency: moneda },
      ...(dto.motivoAjuste !== undefined ? { motivoAjuste: dto.motivoAjuste } : {}),
      ...(referenciaOrigen !== undefined ? { referenciaOrigen } : {}),
    });

    const hashIntegridad = calcularHashIntegridad(documento);
    const respuesta = await this.middleware.transmitir(documento);
    const retenerHasta = calcularFechaLimiteRetencion(ahora).toISOString().slice(0, 10);
    const comprobanteId = newId();

    const enContingencia = respuesta.estado === 'CONTINGENCIA';
    const ri = enContingencia ? generarRepresentacionImpresa(documento, 'MIDDLEWARE_NO_DISPONIBLE', ahora) : null;

    await this.db.tx.insert(comprobantesEcf).values({
      id: comprobanteId,
      tenantId,
      empresaId,
      proyectoId,
      facturaClienteId,
      tipoEcf: dto.tipo,
      ncf,
      estado: respuesta.estado,
      comprobanteOrigenId,
      documento,
      hashIntegridad,
      enContingencia,
      riNumero: ri?.numeroRi ?? null,
      riCodigoSeguridad: ri?.codigoSeguridad ?? null,
      riFechaLimiteRegularizacion: ri ? ri.fechaLimiteRegularizacion.slice(0, 10) : null,
      montoSubtotal: montoSubtotal.toFixed(4),
      montoItbis: montoItbis.toFixed(4),
      montoTotal: montoTotal.toFixed(4),
      moneda,
      fechaEmision,
      retenerHasta,
      eventoId: null,
      createdAt: ahora,
      createdBy: usuarioId,
      updatedAt: ahora,
      updatedBy: usuarioId,
    });

    if (respuesta.estado === 'ACEPTADO') {
      const hashAcuse = calcularHashIntegridad(respuesta.payloadAcuse);
      await this.db.tx.insert(acusesEcf).values({
        id: newId(),
        tenantId,
        comprobanteEcfId: comprobanteId,
        estadoDgii: respuesta.estado,
        codigoSeguridad: respuesta.codigoSeguridad ?? null,
        fechaRecepcionDgii: respuesta.fechaRecepcionDgii ? new Date(respuesta.fechaRecepcionDgii) : null,
        payload: respuesta.payloadAcuse,
        hashIntegridad: hashAcuse,
        retenerHasta,
        createdAt: ahora,
        createdBy: usuarioId,
        updatedAt: ahora,
        updatedBy: usuarioId,
      });
    }

    const evento = await this.ledger.append({
      tenantId,
      empresaId,
      proyectoId,
      centroCostoId: null,
      tipoEvento: 'emision_ecf',
      usuarioId,
      payload: {
        comprobanteEcfId: comprobanteId,
        tipoEcf: dto.tipo,
        ncf,
        facturaClienteId: facturaClienteId ?? undefined,
        comprobanteOrigenId: comprobanteOrigenId ?? undefined,
        fechaEmision,
        montoTotal: { amount: montoTotal.toFixed(4), currency: moneda },
        estado: respuesta.estado,
      },
      referenciaId: comprobanteId,
      referenciaTabla: 'comprobante_ecf',
      idempotencyKey: `emision_ecf:${comprobanteId}`,
    });

    await this.db.tx
      .update(comprobantesEcf)
      .set({ eventoId: evento.id, updatedAt: new Date(), updatedBy: usuarioId })
      .where(eq(comprobantesEcf.id, comprobanteId));

    if (facturaClienteId && respuesta.estado !== 'RECHAZADO') {
      await this.db.tx
        .update(facturasCliente)
        .set({ ncf, updatedAt: new Date(), updatedBy: usuarioId })
        .where(eq(facturasCliente.id, facturaClienteId));
    }

    return {
      id: comprobanteId,
      ncf,
      estado: respuesta.estado,
      enContingencia,
      eventoId: evento.id,
      ri: ri ?? undefined,
    };
  }

  async findAll(tenantId: string, facturaClienteId?: string) {
    const conditions = [eq(comprobantesEcf.tenantId, tenantId)];
    if (facturaClienteId) conditions.push(eq(comprobantesEcf.facturaClienteId, facturaClienteId));
    return this.db.tx
      .select()
      .from(comprobantesEcf)
      .where(and(...conditions));
  }

  async findById(tenantId: string, id: string) {
    const [comprobante] = await this.db.tx
      .select()
      .from(comprobantesEcf)
      .where(and(eq(comprobantesEcf.id, id), eq(comprobantesEcf.tenantId, tenantId)))
      .limit(1);
    if (!comprobante) throw new NotFoundException(`Comprobante e-CF ${id} no encontrado`);

    const [acuse] = await this.db.tx
      .select()
      .from(acusesEcf)
      .where(and(eq(acusesEcf.comprobanteEcfId, id), eq(acusesEcf.tenantId, tenantId)))
      .limit(1);

    return { ...comprobante, acuse: acuse ?? null };
  }
}
