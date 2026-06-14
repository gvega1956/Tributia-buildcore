import { Injectable, NotFoundException, ForbiddenException, Inject, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import {
  notificaciones,
  type NotificacionInsert,
  type NotificacionSelect,
} from '../db/schema/notificaciones/notificacion.js';
import type { CrearNotificacionInput } from '@tributia/documental';
import {
  NOTIFICACION_CHANNELS,
  type INotificacionChannel,
} from './notificacion-channel.interface.js';
import { newId } from '@tributia/shared';

@Injectable()
export class NotificacionService {
  private readonly logger = new Logger(NotificacionService.name);

  constructor(
    private readonly db: DbService,
    @Inject(NOTIFICACION_CHANNELS)
    private readonly channels: INotificacionChannel[],
  ) {}

  // ── Crear notificación in-app ─────────────────────────────────────────────

  async crear(
    tenantId: string,
    createdBy: string,
    input: CrearNotificacionInput,
  ): Promise<NotificacionSelect> {
    const now = new Date();
    const data: NotificacionInsert = {
      id: newId(),
      tenantId,
      usuarioId: input.usuarioId,
      tipo: input.tipo,
      canal: input.canal,
      asunto: input.asunto,
      cuerpo: input.cuerpo,
      referenciaTipo: input.referenciaTipo ?? null,
      referenciaId: input.referenciaId ?? null,
      createdAt: now,
      createdBy,
      updatedAt: now,
      updatedBy: createdBy,
    };

    const [row] = await this.db.tx.insert(notificaciones).values(data).returning();
    const notificacion = row!;

    // Despachar al canal correspondiente de forma asíncrona (no bloquea la respuesta)
    this.despacharAsync(notificacion);

    return notificacion;
  }

  // ── Marcar como leída ──────────────────────────────────────────────────────

  async marcarLeida(id: string, usuarioId: string): Promise<NotificacionSelect> {
    const [row] = await this.db.tx
      .select()
      .from(notificaciones)
      .where(eq(notificaciones.id, id))
      .limit(1);

    if (!row) throw new NotFoundException(`Notificación '${id}' no encontrada.`);
    if (row.usuarioId !== usuarioId) throw new ForbiddenException('No es tu notificación.');

    const now = new Date();
    const [updated] = await this.db.tx
      .update(notificaciones)
      .set({ leida: true, leidaEn: now, updatedAt: now, updatedBy: usuarioId })
      .where(eq(notificaciones.id, id))
      .returning();

    return updated!;
  }

  // ── Consultas ──────────────────────────────────────────────────────────────

  async pendientesPorUsuario(
    usuarioId: string,
    tenantId: string,
  ): Promise<NotificacionSelect[]> {
    return this.db.tx
      .select()
      .from(notificaciones)
      .where(
        and(
          eq(notificaciones.tenantId, tenantId),
          eq(notificaciones.usuarioId, usuarioId),
          eq(notificaciones.leida, false),
          eq(notificaciones.canal, 'IN_APP'),
        ),
      )
      .orderBy(notificaciones.createdAt);
  }

  async todasPorUsuario(
    usuarioId: string,
    tenantId: string,
  ): Promise<NotificacionSelect[]> {
    return this.db.tx
      .select()
      .from(notificaciones)
      .where(
        and(
          eq(notificaciones.tenantId, tenantId),
          eq(notificaciones.usuarioId, usuarioId),
          eq(notificaciones.canal, 'IN_APP'),
        ),
      )
      .orderBy(notificaciones.createdAt);
  }

  // ── Despacho a canales externos ───────────────────────────────────────────

  /**
   * Envía la notificación por su canal y actualiza enviada_en en BD.
   * Ejecutado fire-and-forget; los errores se registran pero no propagan.
   */
  private despacharAsync(notificacion: NotificacionSelect): void {
    const channel = this.channels.find((c) => c.canal === notificacion.canal);
    if (!channel || notificacion.canal === 'IN_APP') {
      // IN_APP no necesita despacho externo; ya está en BD
      void this.marcarEnviada(notificacion.id, notificacion.updatedBy);
      return;
    }

    channel
      .enviar(notificacion)
      .then(() => this.marcarEnviada(notificacion.id, notificacion.updatedBy))
      .catch((err: unknown) => {
        this.logger.error(`Error despachando notificacion=${notificacion.id}`, err);
      });
  }

  private async marcarEnviada(id: string, updatedBy: string): Promise<void> {
    const now = new Date();
    await this.db.tx
      .update(notificaciones)
      .set({ enviadaEn: now, updatedAt: now, updatedBy })
      .where(eq(notificaciones.id, id));
  }
}
