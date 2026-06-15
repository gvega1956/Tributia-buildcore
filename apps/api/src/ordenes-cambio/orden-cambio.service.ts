import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ordenCambios } from '../db/schema/ordenes_cambio/orden_cambio.js';
import { lineasOrdenCambio } from '../db/schema/ordenes_cambio/linea_orden_cambio.js';
import { proyectos } from '../db/schema/proyectos/proyecto.js';

// ── DTOs ─────────────────────────────────────────────────────────────────────

const zUUID = z.string().uuid();
const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con máximo 4 decimales');

export const zCreateOcDto = z.object({
  empresaId: zUUID,
  proyectoId: zUUID,
  causa: z.enum(['CLIENTE', 'DISENO', 'CAMPO', 'IMPREVISTO']),
  descripcion: z.string().min(1),
  diasAdicionalesSolicitados: z.number().int().positive().optional(),
});

export const zAddLineaOcDto = z.object({
  partidaId: zUUID.optional(),
  descripcion: z.string().min(1),
  esPartidaNueva: z.boolean().default(false),
  cantidadAdicional: zDecimal.optional(),
  montoAdicional: zDecimal,
  tipoImpacto: z.enum(['COSTO', 'PLAZO', 'COSTO_Y_PLAZO']).default('COSTO'),
});

export const zAprobarOcDto = z.object({
  montoAprobado: zDecimal,
  diasAdicionalesAprobados: z.number().int().positive().optional(),
});

export const zRechazarOcDto = z.object({
  razonRechazo: z.string().min(1),
});

export type CreateOcDto = z.infer<typeof zCreateOcDto>;
export type AddLineaOcDto = z.infer<typeof zAddLineaOcDto>;
export type AprobarOcDto = z.infer<typeof zAprobarOcDto>;
export type RechazarOcDto = z.infer<typeof zRechazarOcDto>;

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class OrdenCambioService {
  private readonly logger = new Logger(OrdenCambioService.name);

  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  async crear(tenantId: string, dto: CreateOcDto, usuarioId: string) {
    const now = new Date();

    // Número secuencial por proyecto
    const numeroRows = await this.db.tx
      .select({ numero: sql<number>`coalesce(max(numero), 0)::int + 1` })
      .from(ordenCambios)
      .where(and(eq(ordenCambios.tenantId, tenantId), eq(ordenCambios.proyectoId, dto.proyectoId)));

    const [oc] = await this.db.tx
      .insert(ordenCambios)
      .values({
        id: newId(),
        tenantId,
        empresaId: dto.empresaId,
        proyectoId: dto.proyectoId,
        numero: numeroRows[0]?.numero ?? 1,
        causa: dto.causa,
        descripcion: dto.descripcion,
        estado: 'BORRADOR',
        montoEstimado: '0.0000',
        diasAdicionalesSolicitados: dto.diasAdicionalesSolicitados ?? null,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();

    return oc!;
  }

  async agregarLinea(tenantId: string, ocId: string, dto: AddLineaOcDto, usuarioId: string) {
    const now = new Date();
    const oc = await this.findOcOrFail(tenantId, ocId);

    if (oc.estado !== 'BORRADOR') {
      throw new BadRequestException(`No se pueden agregar líneas a una OC en estado ${String(oc.estado)}.`);
    }

    const [linea] = await this.db.tx
      .insert(lineasOrdenCambio)
      .values({
        id: newId(),
        tenantId,
        ordenCambioId: ocId,
        partidaId: dto.partidaId ?? null,
        descripcion: dto.descripcion,
        esPartidaNueva: dto.esPartidaNueva,
        cantidadAdicional: dto.cantidadAdicional ?? null,
        montoAdicional: dto.montoAdicional,
        tipoImpacto: dto.tipoImpacto,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();

    // Recalcular montoEstimado como suma de todas las líneas
    const totalRows = await this.db.tx
      .select({ total: sql<string>`coalesce(sum(monto_adicional), 0)::text` })
      .from(lineasOrdenCambio)
      .where(and(eq(lineasOrdenCambio.tenantId, tenantId), eq(lineasOrdenCambio.ordenCambioId, ocId)));

    await this.db.tx
      .update(ordenCambios)
      .set({ montoEstimado: new Decimal(totalRows[0]?.total ?? '0').toFixed(4), updatedAt: now, updatedBy: usuarioId })
      .where(eq(ordenCambios.id, ocId));

    return linea!;
  }

  async enviarAlCliente(tenantId: string, ocId: string, usuarioId: string) {
    const now = new Date();
    const oc = await this.findOcOrFail(tenantId, ocId);

    if (oc.estado !== 'BORRADOR') {
      throw new ConflictException(`La OC está en estado ${String(oc.estado)}, no BORRADOR.`);
    }

    // Verificar que tiene al menos una línea
    const countRows = await this.db.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(lineasOrdenCambio)
      .where(and(eq(lineasOrdenCambio.tenantId, tenantId), eq(lineasOrdenCambio.ordenCambioId, ocId)));

    if ((countRows[0]?.count ?? 0) === 0) {
      throw new BadRequestException('La OC debe tener al menos una línea antes de enviarse al cliente.');
    }

    const [updated] = await this.db.tx
      .update(ordenCambios)
      .set({ estado: 'ENVIADO_CLIENTE', updatedAt: now, updatedBy: usuarioId })
      .where(eq(ordenCambios.id, ocId))
      .returning();

    return updated!;
  }

  async aprobar(tenantId: string, ocId: string, dto: AprobarOcDto, usuarioId: string) {
    const now = new Date();
    const oc = await this.findOcOrFail(tenantId, ocId);

    if (oc.estado !== 'ENVIADO_CLIENTE') {
      throw new ConflictException(`La OC está en estado ${String(oc.estado)}, se requiere ENVIADO_CLIENTE.`);
    }

    // Cargar líneas para el payload del evento
    const lineas = await this.db.tx
      .select()
      .from(lineasOrdenCambio)
      .where(and(eq(lineasOrdenCambio.tenantId, tenantId), eq(lineasOrdenCambio.ordenCambioId, ocId)));

    // Emitir evento — el handler OrdenCambioAprobadaHandler actualizará ejecucion_partida síncronamente
    const evento = await this.ledger.append({
      tenantId,
      empresaId: oc.empresaId,
      proyectoId: oc.proyectoId,
      centroCostoId: null,
      tipoEvento: 'orden_cambio_aprobada',
      usuarioId,
      referenciaId: ocId,
      referenciaTabla: 'orden_cambio',
      idempotencyKey: `oc_aprobada:${ocId}`,
      payload: {
        ordenCambioId: ocId,
        proyectoId: oc.proyectoId,
        causa: oc.causa,
        descripcion: oc.descripcion,
        montoAprobado: dto.montoAprobado,
        diasAdicionalesAprobados: dto.diasAdicionalesAprobados ?? null,
        lineas: lineas.map((l) => ({
          lineaOrdenCambioId: l.id,
          partidaId: l.partidaId ?? null,
          esPartidaNueva: l.esPartidaNueva,
          descripcion: l.descripcion,
          montoAdicional: l.montoAdicional,
          cantidadAdicional: l.cantidadAdicional ?? null,
        })),
      },
    });

    // Actualizar OC
    const [updated] = await this.db.tx
      .update(ordenCambios)
      .set({
        estado: 'APROBADO',
        montoAprobado: dto.montoAprobado,
        diasAdicionalesAprobados: dto.diasAdicionalesAprobados ?? null,
        aprobadoPor: usuarioId,
        aprobadoEn: now,
        eventoId: evento.id,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(ordenCambios.id, ocId))
      .returning();

    // Incrementar presupuesto_vigente_monto del proyecto
    const [proyecto] = await this.db.tx
      .select({ presupuestoVigenteMonto: proyectos.presupuestoVigenteMonto })
      .from(proyectos)
      .where(eq(proyectos.id, oc.proyectoId))
      .limit(1);

    if (proyecto) {
      const nuevoVigente = new Decimal(proyecto.presupuestoVigenteMonto ?? '0')
        .plus(new Decimal(dto.montoAprobado))
        .toFixed(4);

      await this.db.tx
        .update(proyectos)
        .set({ presupuestoVigenteMonto: nuevoVigente, updatedAt: now, updatedBy: usuarioId })
        .where(eq(proyectos.id, oc.proyectoId));
    }

    this.logger.log(`OC ${ocId} aprobada por ${usuarioId}. Monto: ${dto.montoAprobado}`);
    return updated!;
  }

  async rechazar(tenantId: string, ocId: string, dto: RechazarOcDto, usuarioId: string) {
    const now = new Date();
    const oc = await this.findOcOrFail(tenantId, ocId);

    if (oc.estado !== 'ENVIADO_CLIENTE') {
      throw new ConflictException(`La OC está en estado ${String(oc.estado)}, se requiere ENVIADO_CLIENTE.`);
    }

    const [updated] = await this.db.tx
      .update(ordenCambios)
      .set({
        estado: 'RECHAZADO',
        rechazadoPor: usuarioId,
        razonRechazo: dto.razonRechazo,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(ordenCambios.id, ocId))
      .returning();

    return updated!;
  }

  async anular(tenantId: string, ocId: string, usuarioId: string) {
    const now = new Date();
    const oc = await this.findOcOrFail(tenantId, ocId);

    if (oc.estado !== 'BORRADOR' && oc.estado !== 'ENVIADO_CLIENTE') {
      throw new ConflictException(`Solo se pueden anular OCs en BORRADOR o ENVIADO_CLIENTE.`);
    }

    const [updated] = await this.db.tx
      .update(ordenCambios)
      .set({ estado: 'ANULADO', updatedAt: now, updatedBy: usuarioId })
      .where(eq(ordenCambios.id, ocId))
      .returning();

    return updated!;
  }

  async findAll(tenantId: string, proyectoId?: string) {
    const conditions = [eq(ordenCambios.tenantId, tenantId)];
    if (proyectoId) conditions.push(eq(ordenCambios.proyectoId, proyectoId));

    return this.db.tx
      .select()
      .from(ordenCambios)
      .where(and(...conditions))
      .orderBy(ordenCambios.numero);
  }

  async findById(tenantId: string, ocId: string) {
    const oc = await this.findOcOrFail(tenantId, ocId);

    const lineas = await this.db.tx
      .select()
      .from(lineasOrdenCambio)
      .where(and(eq(lineasOrdenCambio.tenantId, tenantId), eq(lineasOrdenCambio.ordenCambioId, ocId)));

    return { oc, lineas };
  }

  async historial(tenantId: string, proyectoId: string) {
    return this.db.tx
      .select({
        causa: ordenCambios.causa,
        count: sql<number>`count(*)::int`,
        montoTotal: sql<string>`coalesce(sum(monto_aprobado), 0)::text`,
      })
      .from(ordenCambios)
      .where(
        and(
          eq(ordenCambios.tenantId, tenantId),
          eq(ordenCambios.proyectoId, proyectoId),
          eq(ordenCambios.estado, 'APROBADO'),
        ),
      )
      .groupBy(ordenCambios.causa);
  }

  private async findOcOrFail(tenantId: string, ocId: string) {
    const [oc] = await this.db.tx
      .select()
      .from(ordenCambios)
      .where(and(eq(ordenCambios.tenantId, tenantId), eq(ordenCambios.id, ocId)))
      .limit(1);

    if (!oc) throw new NotFoundException(`Orden de cambio ${ocId} no encontrada.`);
    return oc;
  }
}
