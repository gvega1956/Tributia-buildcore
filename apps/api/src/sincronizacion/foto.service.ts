import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { fotosCampo, type EstadoFotoCampo } from '../db/schema/sincronizacion/foto_campo.js';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export const zRegistrarFotoDto = z.object({
  empresaId: z.string().uuid(),
  entidadTipo: z.enum(['parte_diario', 'recepcion_oc', 'avance_obra', 'orden_compra']),
  entidadId: z.string().uuid(),
  latitud: z.number().min(-90).max(90).optional(),
  longitud: z.number().min(-180).max(180).optional(),
  precisionMetros: z.number().positive().optional(),
  timestampCaptura: z.string().datetime(),
  hashLocal: z.string().min(1).max(100),
  bytes: z.number().int().positive().optional(),
  mimeType: z.string().max(50).optional(),
});

export type RegistrarFotoDto = z.infer<typeof zRegistrarFotoDto>;

export interface FotoCampoPublic {
  id: string;
  entidadTipo: string;
  entidadId: string;
  estado: EstadoFotoCampo;
  latitud: string | null;
  longitud: string | null;
  precisionMetros: string | null;
  timestampCaptura: Date;
  hashLocal: string;
  bytes: number | null;
  mimeType: string | null;
  storageKey: string | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class FotoCampoService {
  constructor(private readonly db: DbService) {}

  /**
   * Registra una foto capturada offline.
   *
   * Idempotente por (tenant_id, entidad_id, hash_local): si la foto ya fue
   * registrada (mismo contenido para la misma entidad), devuelve la existente.
   */
  async registrarFoto(
    tenantId: string,
    usuarioId: string,
    dto: RegistrarFotoDto,
  ): Promise<FotoCampoPublic> {
    const parsed = zRegistrarFotoDto.parse(dto);

    // Buscar existente por hash + entidad
    const [existente] = await this.db.tx
      .select()
      .from(fotosCampo)
      .where(
        and(
          eq(fotosCampo.tenantId, tenantId),
          eq(fotosCampo.entidadId, parsed.entidadId),
          eq(fotosCampo.hashLocal, parsed.hashLocal),
        ),
      )
      .limit(1);

    if (existente) {
      return this.toPublic(existente);
    }

    const id = newId();
    const now = new Date();
    const uid = usuarioId || SYSTEM_USER_ID;

    const insertRows = await this.db.tx
      .insert(fotosCampo)
      .values({
        id,
        tenantId,
        empresaId: parsed.empresaId,
        entidadTipo: parsed.entidadTipo,
        entidadId: parsed.entidadId,
        estado: 'PENDIENTE_SUBIDA',
        latitud: parsed.latitud != null ? String(parsed.latitud) : null,
        longitud: parsed.longitud != null ? String(parsed.longitud) : null,
        precisionMetros: parsed.precisionMetros != null ? String(parsed.precisionMetros) : null,
        timestampCaptura: new Date(parsed.timestampCaptura),
        hashLocal: parsed.hashLocal,
        bytes: parsed.bytes ?? null,
        mimeType: parsed.mimeType ?? null,
        createdAt: now,
        createdBy: uid,
        updatedAt: now,
        updatedBy: uid,
      })
      .returning();

    return this.toPublic(insertRows[0]!);
  }

  /**
   * Confirma que el binario fue subido a S3/MinIO.
   * Actualiza storage_key + estado = 'SUBIDA'.
   */
  async confirmarSubida(
    tenantId: string,
    fotoId: string,
    storageKey: string,
    usuarioId: string,
  ): Promise<FotoCampoPublic> {
    const [foto] = await this.db.tx
      .select()
      .from(fotosCampo)
      .where(and(eq(fotosCampo.tenantId, tenantId), eq(fotosCampo.id, fotoId)))
      .limit(1);

    if (!foto) {
      throw new NotFoundException(`Foto ${fotoId} no encontrada`);
    }

    const now = new Date();
    const rows = await this.db.tx
      .update(fotosCampo)
      .set({
        storageKey,
        estado: 'SUBIDA',
        updatedAt: now,
        updatedBy: usuarioId || SYSTEM_USER_ID,
      })
      .where(eq(fotosCampo.id, fotoId))
      .returning();

    // The check above guarantees the row exists; rows[0] is always defined here.
    return this.toPublic(rows[0]!);
  }

  /**
   * Lista fotos pendientes de subida para un tenant.
   */
  async listarPendientes(tenantId: string, limit = 50): Promise<FotoCampoPublic[]> {
    const rows = await this.db.tx
      .select()
      .from(fotosCampo)
      .where(
        and(
          eq(fotosCampo.tenantId, tenantId),
          eq(fotosCampo.estado, 'PENDIENTE_SUBIDA'),
        ),
      )
      .limit(limit);

    return rows.map((r) => this.toPublic(r));
  }

  /**
   * Obtiene una foto por ID.
   */
  async obtenerPorId(tenantId: string, fotoId: string): Promise<FotoCampoPublic> {
    const [foto] = await this.db.tx
      .select()
      .from(fotosCampo)
      .where(and(eq(fotosCampo.tenantId, tenantId), eq(fotosCampo.id, fotoId)))
      .limit(1);

    if (!foto) {
      throw new NotFoundException(`Foto ${fotoId} no encontrada`);
    }

    return this.toPublic(foto);
  }

  private toPublic(row: typeof fotosCampo.$inferSelect): FotoCampoPublic {
    return {
      id: row.id,
      entidadTipo: row.entidadTipo,
      entidadId: row.entidadId,
      estado: row.estado,
      latitud: row.latitud,
      longitud: row.longitud,
      precisionMetros: row.precisionMetros,
      timestampCaptura: row.timestampCaptura,
      hashLocal: row.hashLocal,
      bytes: row.bytes,
      mimeType: row.mimeType,
      storageKey: row.storageKey,
    };
  }
}
