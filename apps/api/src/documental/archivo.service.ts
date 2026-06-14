import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { eq, and, lte, isNull, or, sql } from 'drizzle-orm';
import * as crypto from 'node:crypto';
import { DbService } from '../database/db.service.js';
import {
  archivos,
  type ArchivoInsert,
  type ArchivoSelect,
} from '../db/schema/documental/archivo.js';
import {
  versionesArchivo,
  type VersionArchivoInsert,
  type VersionArchivoSelect,
} from '../db/schema/documental/version_archivo.js';
import { StorageService } from '../storage/storage.service.js';
import type { SubirArchivoInput, SubirNuevaVersionInput } from '@tributia/documental';
import { newId } from '@tributia/shared';

@Injectable()
export class ArchivoService {
  private readonly logger = new Logger(ArchivoService.name);

  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
  ) {}

  // ── Subir archivo (v1) ────────────────────────────────────────────────────

  async subirArchivo(
    tenantId: string,
    usuarioId: string,
    input: SubirArchivoInput,
    buffer: Buffer,
    contentType: string,
  ): Promise<ArchivoSelect> {
    if (buffer.length === 0) {
      throw new BadRequestException('El archivo no puede estar vacío.');
    }

    const archivoId = newId();
    const storageKey = this.buildKey(tenantId, input.entidadTipo, archivoId, 1, input.nombre);
    const checksum = this.sha256(buffer);

    await this.storage.upload(storageKey, buffer, contentType, {
      tenant: tenantId,
      archivoId,
      checksum,
    });

    const now = new Date();

    const archivoData: ArchivoInsert = {
      id: archivoId,
      tenantId,
      nombre: input.nombre,
      descripcion: input.descripcion ?? null,
      entidadTipo: input.entidadTipo,
      entidadId: input.entidadId,
      categoria: input.categoria,
      fechaVencimiento: input.fechaVencimiento ?? null,
      alertaDiasAntes: input.alertaDiasAntes ?? null,
      versionActual: 1,
      storageKey,
      contentType,
      tamanoBytesActual: buffer.length,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };

    const [archivoRow] = await this.db.tx.insert(archivos).values(archivoData).returning();
    const archivo = archivoRow!;

    const versionData: VersionArchivoInsert = {
      id: newId(),
      tenantId,
      archivoId,
      numeroVersion: 1,
      storageKey,
      contentType,
      tamanoBytes: buffer.length,
      checksumSha256: checksum,
      nota: input.notaVersion ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };

    await this.db.tx.insert(versionesArchivo).values(versionData);

    this.logger.log(`Archivo subido: id=${archivoId} entidad=${input.entidadTipo}/${input.entidadId}`);

    return archivo;
  }

  // ── Subir nueva versión ───────────────────────────────────────────────────

  async subirNuevaVersion(
    archivoId: string,
    tenantId: string,
    usuarioId: string,
    input: SubirNuevaVersionInput,
    buffer: Buffer,
    contentType: string,
  ): Promise<ArchivoSelect> {
    const archivo = await this.findById(archivoId);

    if (!archivo.activo) {
      throw new BadRequestException('El archivo está inactivo y no admite nuevas versiones.');
    }

    const nuevaVersion = archivo.versionActual + 1;
    const storageKey = this.buildKey(tenantId, archivo.entidadTipo, archivoId, nuevaVersion, archivo.nombre);
    const checksum = this.sha256(buffer);

    await this.storage.upload(storageKey, buffer, contentType, {
      tenant: tenantId,
      archivoId,
      version: String(nuevaVersion),
      checksum,
    });

    const now = new Date();

    const versionData: VersionArchivoInsert = {
      id: newId(),
      tenantId,
      archivoId,
      numeroVersion: nuevaVersion,
      storageKey,
      contentType,
      tamanoBytes: buffer.length,
      checksumSha256: checksum,
      nota: input.notaVersion ?? null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };

    await this.db.tx.insert(versionesArchivo).values(versionData);

    const [updated] = await this.db.tx
      .update(archivos)
      .set({
        versionActual: nuevaVersion,
        storageKey,
        contentType,
        tamanoBytesActual: buffer.length,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(archivos.id, archivoId))
      .returning();

    this.logger.log(`Nueva versión v${nuevaVersion} subida para archivo=${archivoId}`);

    return updated!;
  }

  // ── Presigned download URL ────────────────────────────────────────────────

  async getPresignedDownloadUrl(
    archivoId: string,
    numeroVersion?: number,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    let storageKey: string;

    if (numeroVersion !== undefined) {
      const [version] = await this.db.tx
        .select()
        .from(versionesArchivo)
        .where(
          and(
            eq(versionesArchivo.archivoId, archivoId),
            eq(versionesArchivo.numeroVersion, numeroVersion),
          ),
        )
        .limit(1);

      if (!version) {
        throw new NotFoundException(`Versión ${numeroVersion} del archivo '${archivoId}' no encontrada.`);
      }
      storageKey = version.storageKey;
    } else {
      const archivo = await this.findById(archivoId);
      storageKey = archivo.storageKey;
    }

    const url = await this.storage.getPresignedDownloadUrl(storageKey, 3600);
    return { url, expiresInSeconds: 3600 };
  }

  // ── Listado ───────────────────────────────────────────────────────────────

  async listByEntidad(
    tenantId: string,
    entidadTipo: string,
    entidadId: string,
  ): Promise<ArchivoSelect[]> {
    return this.db.tx
      .select()
      .from(archivos)
      .where(
        and(
          eq(archivos.tenantId, tenantId),
          eq(archivos.entidadTipo, entidadTipo),
          eq(archivos.entidadId, entidadId),
          eq(archivos.activo, true),
        ),
      )
      .orderBy(archivos.createdAt);
  }

  async getVersiones(archivoId: string): Promise<VersionArchivoSelect[]> {
    await this.findById(archivoId); // verifica existencia
    return this.db.tx
      .select()
      .from(versionesArchivo)
      .where(eq(versionesArchivo.archivoId, archivoId))
      .orderBy(versionesArchivo.numeroVersion);
  }

  /**
   * Documentos cuyo vencimiento cae dentro de los próximos `diasHasta` días.
   * Incluye documentos ya vencidos (fechaVencimiento <= hoy también).
   */
  async listProximosVencimientos(
    tenantId: string,
    diasHasta = 30,
  ): Promise<ArchivoSelect[]> {
    return this.db.tx
      .select()
      .from(archivos)
      .where(
        and(
          eq(archivos.tenantId, tenantId),
          eq(archivos.activo, true),
          lte(
            archivos.fechaVencimiento,
            sql`(current_date + ${diasHasta} * interval '1 day')::date`,
          ),
        ),
      )
      .orderBy(archivos.fechaVencimiento);
  }

  /**
   * Documentos que deben generar alerta hoy:
   *   fecha_vencimiento - alerta_dias_antes <= hoy
   *   Y no se ha enviado alerta hoy todavía.
   */
  async listParaAlertaHoy(tenantId: string): Promise<ArchivoSelect[]> {
    return this.db.tx
      .select()
      .from(archivos)
      .where(
        and(
          eq(archivos.tenantId, tenantId),
          eq(archivos.activo, true),
          sql`fecha_vencimiento IS NOT NULL`,
          sql`alerta_dias_antes IS NOT NULL`,
          sql`fecha_vencimiento - alerta_dias_antes * interval '1 day' <= current_date`,
          or(
            isNull(archivos.ultimaAlertaEnviada),
            sql`ultima_alerta_enviada < current_date`,
          ),
        ),
      );
  }

  async marcarAlertaEnviada(archivoId: string, updatedBy: string): Promise<void> {
    await this.db.tx
      .update(archivos)
      .set({
        ultimaAlertaEnviada: sql`current_date`,
        updatedAt: new Date(),
        updatedBy,
      })
      .where(eq(archivos.id, archivoId));
  }

  async findById(id: string): Promise<ArchivoSelect> {
    const [row] = await this.db.tx
      .select()
      .from(archivos)
      .where(eq(archivos.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Archivo '${id}' no encontrado.`);
    return row;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildKey(
    tenantId: string,
    entidadTipo: string,
    archivoId: string,
    version: number,
    nombre: string,
  ): string {
    const safeName = nombre.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    return `${tenantId}/${entidadTipo}/${archivoId}/v${version}/${safeName}`;
  }

  private sha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}
