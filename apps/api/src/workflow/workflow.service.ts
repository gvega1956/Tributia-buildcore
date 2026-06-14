import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import {
  instanciasFlujo,
  type InstanciaFlujoInsert,
  type InstanciaFlujoSelect,
} from '../db/schema/workflow/instancia_flujo.js';
import {
  aprobacionesPaso,
  type AprobacionPasoInsert,
  type AprobacionPasoSelect,
} from '../db/schema/workflow/aprobacion_paso.js';
import { pasosFlujo } from '../db/schema/workflow/paso_flujo.js';
import { TipoFlujoService } from './tipo-flujo.service.js';
import type {
  IniciarFlujoInput,
  ResponderAprobacionInput,
  RechazarAprobacionInput,
  DelegarAprobacionInput,
  CancelarFlujoInput,
} from '@tributia/workflow';
import { newId } from '@tributia/shared';

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly db: DbService,
    private readonly tipoFlujoService: TipoFlujoService,
  ) {}

  // ── Iniciar flujo ─────────────────────────────────────────────────────────

  async iniciarFlujo(
    tenantId: string,
    usuarioId: string,
    input: IniciarFlujoInput,
  ): Promise<InstanciaFlujoSelect> {
    const tipoFlujo = await this.tipoFlujoService.resolverTipoFlujo(
      tenantId,
      input.tipoDocumento,
      input.monto ?? null,
    );

    if (!tipoFlujo) {
      throw new BadRequestException(
        `No existe ningún flujo de aprobación configurado para el tipo '${input.tipoDocumento}'.`,
      );
    }

    const pasos = await this.tipoFlujoService.listPasos(tipoFlujo.id);
    if (pasos.length === 0) {
      throw new BadRequestException(
        `El flujo '${tipoFlujo.nombre}' no tiene pasos configurados.`,
      );
    }

    const primerOrden = Math.min(...pasos.map((p) => p.orden));
    const now = new Date();

    // Insertar instancia y primer batch de aprobaciones en la misma transacción
    const instanciaData: InstanciaFlujoInsert = {
      id: newId(),
      tenantId,
      tipoFlujoId: tipoFlujo.id,
      tipoDocumento: input.tipoDocumento,
      documentoId: input.documentoId,
      documentoTabla: input.documentoTabla,
      monto: input.monto ?? null,
      moneda: input.moneda ?? null,
      iniciadoPor: usuarioId,
      estado: 'EN_PROGRESO',
      pasoActual: primerOrden,
      descripcion: input.descripcion,
      metadata: input.metadata ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };

    const [instancia] = await this.db.tx.insert(instanciasFlujo).values(instanciaData).returning();
    const instanciaRow = instancia!;

    await this.crearAprobacionesParaOrden(instanciaRow.id, tenantId, pasos, primerOrden, now, usuarioId);

    this.logger.log(
      `Flujo iniciado: instancia=${instanciaRow.id} tipo=${input.tipoDocumento} doc=${input.documentoId}`,
    );

    return instanciaRow;
  }

  // ── Aprobar ───────────────────────────────────────────────────────────────

  async aprobar(
    aprobacionId: string,
    usuarioId: string,
    input: ResponderAprobacionInput,
  ): Promise<AprobacionPasoSelect> {
    const aprobacion = await this.findAprobacionById(aprobacionId);
    this.validarPendiente(aprobacion);
    this.validarAprobador(aprobacion, usuarioId);

    const now = new Date();

    const [updated] = await this.db.tx
      .update(aprobacionesPaso)
      .set({
        estado: 'APROBADO',
        comentario: input.comentario ?? null,
        respondidoEn: now,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(aprobacionesPaso.id, aprobacionId))
      .returning();

    // Intentar avanzar el flujo
    await this.intentarAvanzar(aprobacion.instanciaId, aprobacion.ordenPaso, usuarioId);

    return updated!;
  }

  // ── Rechazar ──────────────────────────────────────────────────────────────

  async rechazar(
    aprobacionId: string,
    usuarioId: string,
    input: RechazarAprobacionInput,
  ): Promise<AprobacionPasoSelect> {
    const aprobacion = await this.findAprobacionById(aprobacionId);
    this.validarPendiente(aprobacion);
    this.validarAprobador(aprobacion, usuarioId);

    const now = new Date();

    const [updated] = await this.db.tx
      .update(aprobacionesPaso)
      .set({
        estado: 'RECHAZADO',
        comentario: input.comentario,
        respondidoEn: now,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(aprobacionesPaso.id, aprobacionId))
      .returning();

    // Marcar todas las demás aprobaciones pendientes de esta instancia como RECHAZADO
    await this.db.tx
      .update(aprobacionesPaso)
      .set({ estado: 'RECHAZADO', updatedAt: now, updatedBy: usuarioId })
      .where(
        and(
          eq(aprobacionesPaso.instanciaId, aprobacion.instanciaId),
          eq(aprobacionesPaso.estado, 'PENDIENTE'),
        ),
      );

    // Marcar la instancia como RECHAZADO
    await this.db.tx
      .update(instanciasFlujo)
      .set({ estado: 'RECHAZADO', finalizadoEn: now, updatedAt: now, updatedBy: usuarioId })
      .where(eq(instanciasFlujo.id, aprobacion.instanciaId));

    this.logger.log(`Flujo rechazado: instancia=${aprobacion.instanciaId} por usuario=${usuarioId}`);

    return updated!;
  }

  // ── Delegar ───────────────────────────────────────────────────────────────

  async delegar(
    aprobacionId: string,
    usuarioId: string,
    input: DelegarAprobacionInput,
  ): Promise<AprobacionPasoSelect> {
    const aprobacion = await this.findAprobacionById(aprobacionId);
    this.validarPendiente(aprobacion);
    this.validarAprobador(aprobacion, usuarioId);

    // Verificar que el paso permite delegación
    const [paso] = await this.db.tx
      .select()
      .from(pasosFlujo)
      .where(eq(pasosFlujo.id, aprobacion.pasoFlujoId))
      .limit(1);

    if (!paso?.permiteDelegacion) {
      throw new ForbiddenException('Este paso no permite delegación.');
    }

    if (input.delegadoAId === usuarioId) {
      throw new BadRequestException('No puede delegarse a sí mismo.');
    }

    const now = new Date();

    // Marcar la aprobación original como DELEGADO
    await this.db.tx
      .update(aprobacionesPaso)
      .set({
        estado: 'DELEGADO',
        comentario: input.comentario ?? null,
        respondidoEn: now,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(aprobacionesPaso.id, aprobacionId));

    // Crear nueva aprobación para el delegado
    const instancia = await this.findInstanciaById(aprobacion.instanciaId);
    const delegadaData: AprobacionPasoInsert = {
      id: newId(),
      tenantId: instancia.tenantId,
      instanciaId: aprobacion.instanciaId,
      pasoFlujoId: aprobacion.pasoFlujoId,
      ordenPaso: aprobacion.ordenPaso,
      aprobadorId: input.delegadoAId,
      delegadoPor: usuarioId,
      estado: 'PENDIENTE',
      venceEn: aprobacion.venceEn ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };

    const [nueva] = await this.db.tx.insert(aprobacionesPaso).values(delegadaData).returning();
    return nueva!;
  }

  // ── Cancelar flujo ────────────────────────────────────────────────────────

  async cancelarFlujo(
    instanciaId: string,
    usuarioId: string,
    input: CancelarFlujoInput,
  ): Promise<InstanciaFlujoSelect> {
    const instancia = await this.findInstanciaById(instanciaId);

    if (instancia.estado !== 'EN_PROGRESO') {
      throw new ConflictException(
        `Solo se puede cancelar un flujo EN_PROGRESO. Estado actual: ${instancia.estado}`,
      );
    }

    const now = new Date();

    // Marcar aprobaciones pendientes como canceladas (usamos RECHAZADO para mantener el CHECK constraint)
    await this.db.tx
      .update(aprobacionesPaso)
      .set({ estado: 'RECHAZADO', comentario: `Cancelado: ${input.motivo}`, updatedAt: now, updatedBy: usuarioId })
      .where(
        and(
          eq(aprobacionesPaso.instanciaId, instanciaId),
          eq(aprobacionesPaso.estado, 'PENDIENTE'),
        ),
      );

    const [updated] = await this.db.tx
      .update(instanciasFlujo)
      .set({
        estado: 'CANCELADO',
        finalizadoEn: now,
        descripcion: `${instancia.descripcion} [Cancelado: ${input.motivo}]`,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(instanciasFlujo.id, instanciaId))
      .returning();

    return updated!;
  }

  // ── Consultas ─────────────────────────────────────────────────────────────

  async pendientesPorUsuario(
    usuarioId: string,
    tenantId: string,
  ): Promise<AprobacionPasoSelect[]> {
    return this.db.tx
      .select()
      .from(aprobacionesPaso)
      .where(
        and(
          eq(aprobacionesPaso.tenantId, tenantId),
          eq(aprobacionesPaso.aprobadorId, usuarioId),
          eq(aprobacionesPaso.estado, 'PENDIENTE'),
        ),
      )
      .orderBy(aprobacionesPaso.createdAt);
  }

  async historialInstancia(instanciaId: string): Promise<{
    instancia: InstanciaFlujoSelect;
    aprobaciones: AprobacionPasoSelect[];
  }> {
    const instancia = await this.findInstanciaById(instanciaId);
    const aprobaciones = await this.db.tx
      .select()
      .from(aprobacionesPaso)
      .where(eq(aprobacionesPaso.instanciaId, instanciaId))
      .orderBy(aprobacionesPaso.ordenPaso, aprobacionesPaso.createdAt);

    return { instancia, aprobaciones };
  }

  async findInstanciaById(id: string): Promise<InstanciaFlujoSelect> {
    const [row] = await this.db.tx
      .select()
      .from(instanciasFlujo)
      .where(eq(instanciasFlujo.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`InstanciaFlujo '${id}' no encontrada.`);
    return row;
  }

  // ── Motor de transiciones ─────────────────────────────────────────────────

  private async intentarAvanzar(
    instanciaId: string,
    ordenActual: number,
    usuarioId: string,
  ): Promise<void> {
    // Verificar que todas las aprobaciones activas (no DELEGADO) del orden actual estén aprobadas
    const aprobacionesOrden = await this.db.tx
      .select()
      .from(aprobacionesPaso)
      .where(
        and(
          eq(aprobacionesPaso.instanciaId, instanciaId),
          eq(aprobacionesPaso.ordenPaso, ordenActual),
        ),
      );

    // Filtrar las que son "activas" (no delegadas — las delegadas son reemplazadas por la nueva)
    const activas = aprobacionesOrden.filter((a) => a.estado !== 'DELEGADO');
    const pendientes = activas.filter((a) => a.estado === 'PENDIENTE');

    if (pendientes.length > 0) return; // Hay pendientes; no avanzar aún

    const todasAprobadas = activas.every((a) => a.estado === 'APROBADO');
    if (!todasAprobadas) return; // Alguna está en otro estado (shouldn't happen at this point)

    // Todas las aprobaciones activas están APROBADO — buscar siguiente orden
    const instancia = await this.findInstanciaById(instanciaId);
    const pasos = await this.tipoFlujoService.listPasos(instancia.tipoFlujoId);

    const ordenes = [...new Set(pasos.map((p) => p.orden))].sort((a, b) => a - b);
    const indiceActual = ordenes.indexOf(ordenActual);
    const siguienteOrden = indiceActual >= 0 && indiceActual < ordenes.length - 1
      ? ordenes[indiceActual + 1]!
      : null;

    const now = new Date();

    if (siguienteOrden === null) {
      // No hay más pasos → flujo aprobado
      await this.db.tx
        .update(instanciasFlujo)
        .set({ estado: 'APROBADO', finalizadoEn: now, updatedAt: now, updatedBy: usuarioId })
        .where(eq(instanciasFlujo.id, instanciaId));

      this.logger.log(`Flujo aprobado: instancia=${instanciaId}`);
    } else {
      // Avanzar al siguiente orden
      await this.db.tx
        .update(instanciasFlujo)
        .set({ pasoActual: siguienteOrden, updatedAt: now, updatedBy: usuarioId })
        .where(eq(instanciasFlujo.id, instanciaId));

      await this.crearAprobacionesParaOrden(instanciaId, instancia.tenantId, pasos, siguienteOrden, now, usuarioId);

      this.logger.log(`Flujo avanza a orden=${siguienteOrden}: instancia=${instanciaId}`);
    }
  }

  private async crearAprobacionesParaOrden(
    instanciaId: string,
    tenantId: string,
    pasos: Awaited<ReturnType<TipoFlujoService['listPasos']>>,
    orden: number,
    now: Date,
    usuarioId: string,
  ): Promise<void> {
    const pasosOrden = pasos.filter((p) => p.orden === orden);

    const aprobaciones: AprobacionPasoInsert[] = pasosOrden.map((paso) => {
      const venceEn =
        paso.vencimientoHoras !== null
          ? new Date(now.getTime() + paso.vencimientoHoras * 60 * 60 * 1000)
          : null;

      return {
        id: newId(),
        tenantId,
        instanciaId,
        pasoFlujoId: paso.id,
        ordenPaso: orden,
        aprobadorId: paso.aprobadorId,
        estado: 'PENDIENTE' as const,
        venceEn: venceEn ?? null,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      };
    });

    await this.db.tx.insert(aprobacionesPaso).values(aprobaciones);
  }

  private async findAprobacionById(id: string): Promise<AprobacionPasoSelect> {
    const [row] = await this.db.tx
      .select()
      .from(aprobacionesPaso)
      .where(eq(aprobacionesPaso.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`AprobacionPaso '${id}' no encontrada.`);
    return row;
  }

  private validarPendiente(aprobacion: AprobacionPasoSelect): void {
    if (aprobacion.estado !== 'PENDIENTE') {
      throw new ConflictException(
        `Esta aprobación ya no está pendiente (estado: ${aprobacion.estado}).`,
      );
    }
  }

  private validarAprobador(aprobacion: AprobacionPasoSelect, usuarioId: string): void {
    if (aprobacion.aprobadorId !== usuarioId) {
      throw new ForbiddenException('Solo el aprobador asignado puede responder esta aprobación.');
    }
  }
}
