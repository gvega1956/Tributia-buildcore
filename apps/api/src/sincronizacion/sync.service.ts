import { Injectable } from '@nestjs/common';
import { eq, and, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import {
  colaSincronizacion,
  type TipoOperacionSync,
  type EstadoColaSync,
  type RolSync,
  ROL_PRIORIDAD,
  TIPOS_OPERACION_SYNC,
  ROLES_SYNC,
} from '../db/schema/sincronizacion/cola_sincronizacion.js';

// ─── DTOs / Schemas ───────────────────────────────────────────────────────────

export const zSyncOperacion = z.object({
  idempotencyKey: z.string().min(1).max(255),
  tipoOperacion: z.enum(TIPOS_OPERACION_SYNC),
  empresaId: z.string().uuid(),
  payload: z.record(z.unknown()),
  ocurridoEn: z.string().datetime(),
  dispositivoId: z.string().min(1).max(100),
  rolUsuario: z.enum(ROLES_SYNC),
});

export const zBatchSyncDto = z.object({
  operaciones: z.array(zSyncOperacion).min(1).max(100),
});

export type SyncOperacionDto = z.infer<typeof zSyncOperacion>;
export type BatchSyncDto = z.infer<typeof zBatchSyncDto>;

export interface SyncOperacionResult {
  idempotencyKey: string;
  estado: EstadoColaSync;
  conflictoDetalle?: string;
  colaId?: string;
}

export interface BatchSyncResult {
  totalPendiente: number;
  totalConflicto: number;
  totalError: number;
  operaciones: SyncOperacionResult[];
}

export interface EstadoSyncResumen {
  pendienteEjecucion: number;
  procesado: number;
  conflicto: number;
  error: number;
  anuladoPorConflicto: number;
}

// ─── Conflict detection key ──────────────────────────────────────────────────

/**
 * Solo avance_partida genera conflictos: dos avances del mismo partida en el
 * mismo día UTC se consideran conflictivos (solo uno debe devengarse).
 * Las demás operaciones son aditivas: consumo/horas siempre se acumulan.
 */
function esOperacionConConflictoPotencial(tipo: TipoOperacionSync): boolean {
  return tipo === 'avance_partida';
}

function conflictoKeyPartidaFecha(payload: Record<string, unknown>, ocurridoEn: string): string | null {
  const partidaId = payload['partidaId'];
  if (typeof partidaId !== 'string') return null;
  const fecha = ocurridoEn.slice(0, 10); // YYYY-MM-DD
  return `${partidaId}::${fecha}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SyncService {
  constructor(private readonly db: DbService) {}

  /**
   * Procesa un lote de operaciones offline.
   *
   * Por cada operación:
   *  1. Si la idempotency_key ya existe → devuelve el estado registrado (no duplica).
   *  2. Si es avance_partida y hay conflicto con una entrada existente:
   *     - Rol nuevo > existente → nuevo gana, existente → ANULADO_POR_CONFLICTO.
   *     - Rol nuevo <= existente → nuevo → CONFLICTO.
   *  3. Resto: siempre → PENDIENTE_EJECUCION (consumo_material y horas son aditivas).
   */
  async procesarBatch(
    tenantId: string,
    usuarioId: string,
    dto: BatchSyncDto,
  ): Promise<BatchSyncResult> {
    const resultados: SyncOperacionResult[] = [];

    for (const op of dto.operaciones) {
      const result = await this.procesarOperacion(tenantId, usuarioId, op);
      resultados.push(result);
    }

    return {
      totalPendiente: resultados.filter((r) => r.estado === 'PENDIENTE_EJECUCION').length,
      totalConflicto: resultados.filter((r) => r.estado === 'CONFLICTO').length,
      totalError: resultados.filter((r) => r.estado === 'ERROR').length,
      operaciones: resultados,
    };
  }

  private async procesarOperacion(
    tenantId: string,
    usuarioId: string,
    op: SyncOperacionDto,
  ): Promise<SyncOperacionResult> {
    // 1. Idempotencia: ¿ya existe esta key?
    const [existente] = await this.db.tx
      .select({
        id: colaSincronizacion.id,
        estado: colaSincronizacion.estado,
        conflictoDetalle: colaSincronizacion.conflictoDetalle,
      })
      .from(colaSincronizacion)
      .where(
        and(
          eq(colaSincronizacion.tenantId, tenantId),
          eq(colaSincronizacion.idempotencyKey, op.idempotencyKey),
        ),
      )
      .limit(1);

    if (existente) {
      return {
        idempotencyKey: op.idempotencyKey,
        estado: existente.estado,
        colaId: existente.id,
        ...(existente.conflictoDetalle ? { conflictoDetalle: existente.conflictoDetalle } : {}),
      };
    }

    // 2. Detección de conflicto (solo avance_partida)
    if (esOperacionConConflictoPotencial(op.tipoOperacion)) {
      const conflictoKey = conflictoKeyPartidaFecha(op.payload, op.ocurridoEn);
      if (conflictoKey) {
        const conflicto = await this.buscarConflictoAvance(tenantId, op, conflictoKey);
        if (conflicto) {
          return await this.resolverConflicto(tenantId, usuarioId, op, conflicto);
        }
      }
    }

    // 3. Sin conflicto → encolar como PENDIENTE_EJECUCION
    const id = await this.encolarOperacion(tenantId, usuarioId, op, 'PENDIENTE_EJECUCION', null, null);
    return { idempotencyKey: op.idempotencyKey, estado: 'PENDIENTE_EJECUCION', colaId: id };
  }

  private async buscarConflictoAvance(
    tenantId: string,
    op: SyncOperacionDto,
    _conflictoKey: string,
  ): Promise<{ id: string; rolUsuario: RolSync } | null> {
    const partidaId = op.payload['partidaId'] as string;
    const fecha = op.ocurridoEn.slice(0, 10);

    const [rival] = await this.db.tx
      .select({
        id: colaSincronizacion.id,
        rolUsuario: colaSincronizacion.rolUsuario,
        idempotencyKey: colaSincronizacion.idempotencyKey,
      })
      .from(colaSincronizacion)
      .where(
        and(
          eq(colaSincronizacion.tenantId, tenantId),
          eq(colaSincronizacion.tipoOperacion, 'avance_partida'),
          sql`${colaSincronizacion.estado} IN ('PENDIENTE_EJECUCION','PROCESADO')`,
          sql`(${colaSincronizacion.payload}->>'partidaId')::text = ${partidaId}`,
          sql`date(${colaSincronizacion.ocurridoEn} AT TIME ZONE 'UTC') = ${fecha}::date`,
          ne(colaSincronizacion.idempotencyKey, op.idempotencyKey),
        ),
      )
      .limit(1);

    return rival ? { id: rival.id, rolUsuario: rival.rolUsuario } : null;
  }

  private async resolverConflicto(
    tenantId: string,
    usuarioId: string,
    op: SyncOperacionDto,
    rival: { id: string; rolUsuario: RolSync },
  ): Promise<SyncOperacionResult> {
    const prioridadNuevo = ROL_PRIORIDAD[op.rolUsuario];
    const prioridadExistente = ROL_PRIORIDAD[rival.rolUsuario];

    if (prioridadNuevo > prioridadExistente) {
      // Nuevo gana: marcar rival como ANULADO_POR_CONFLICTO
      const now = new Date();
      await this.db.tx
        .update(colaSincronizacion)
        .set({
          estado: 'ANULADO_POR_CONFLICTO',
          conflictoDetalle: `Anulado por operación con rol ${op.rolUsuario} (prioridad ${prioridadNuevo} > ${prioridadExistente})`,
          updatedAt: now,
          updatedBy: usuarioId,
        })
        .where(eq(colaSincronizacion.id, rival.id));

      const detalle = `Conflicto resuelto: ${op.rolUsuario}(${prioridadNuevo}) > ${rival.rolUsuario}(${prioridadExistente}). Operación rival anulada.`;
      const id = await this.encolarOperacion(tenantId, usuarioId, op, 'PENDIENTE_EJECUCION', rival.id, detalle);
      return { idempotencyKey: op.idempotencyKey, estado: 'PENDIENTE_EJECUCION', colaId: id, conflictoDetalle: detalle };
    } else {
      // Nuevo pierde
      const detalle = `Conflicto: rol ${op.rolUsuario}(${prioridadNuevo}) pierde frente a ${rival.rolUsuario}(${prioridadExistente}) ya registrado.`;
      const id = await this.encolarOperacion(tenantId, usuarioId, op, 'CONFLICTO', rival.id, detalle);
      return { idempotencyKey: op.idempotencyKey, estado: 'CONFLICTO', conflictoDetalle: detalle, colaId: id };
    }
  }

  private async encolarOperacion(
    tenantId: string,
    usuarioId: string,
    op: SyncOperacionDto,
    estado: EstadoColaSync,
    conflictoConId: string | null,
    conflictoDetalle: string | null,
  ): Promise<string> {
    const id = newId();
    const now = new Date();
    await this.db.tx.insert(colaSincronizacion).values({
      id,
      tenantId,
      empresaId: op.empresaId,
      usuarioId,
      rolUsuario: op.rolUsuario,
      dispositivoId: op.dispositivoId,
      tipoOperacion: op.tipoOperacion,
      payload: op.payload,
      ocurridoEn: new Date(op.ocurridoEn),
      idempotencyKey: op.idempotencyKey,
      estado,
      conflictoConId: conflictoConId,
      conflictoDetalle: conflictoDetalle,
      createdAt: now,
      createdBy: usuarioId || SYSTEM_USER_ID,
      updatedAt: now,
      updatedBy: usuarioId || SYSTEM_USER_ID,
    });
    return id;
  }

  /**
   * Resumen del estado de la cola para un tenant.
   * Usado por GET /api/v1/sync/estado.
   */
  async obtenerEstado(tenantId: string): Promise<EstadoSyncResumen> {
    const rows = await this.db.tx
      .select({
        estado: colaSincronizacion.estado,
        count: sql<string>`count(*)`,
      })
      .from(colaSincronizacion)
      .where(eq(colaSincronizacion.tenantId, tenantId))
      .groupBy(colaSincronizacion.estado);

    const mapa: Record<string, number> = {};
    for (const row of rows) {
      mapa[row.estado] = parseInt(row.count, 10);
    }

    return {
      pendienteEjecucion: mapa['PENDIENTE_EJECUCION'] ?? 0,
      procesado: mapa['PROCESADO'] ?? 0,
      conflicto: mapa['CONFLICTO'] ?? 0,
      error: mapa['ERROR'] ?? 0,
      anuladoPorConflicto: mapa['ANULADO_POR_CONFLICTO'] ?? 0,
    };
  }

  /**
   * Lista operaciones pendientes de ejecución (para el worker).
   * Retorna hasta `limit` entradas ordenadas por ocurrido_en ASC.
   */
  async listarPendientes(tenantId: string, limit = 50) {
    return this.db.tx
      .select()
      .from(colaSincronizacion)
      .where(
        and(
          eq(colaSincronizacion.tenantId, tenantId),
          eq(colaSincronizacion.estado, 'PENDIENTE_EJECUCION'),
        ),
      )
      .orderBy(colaSincronizacion.ocurridoEn)
      .limit(limit);
  }

  /**
   * Marca una operación de la cola como PROCESADO.
   * Llamado por SyncWorkerService luego de ejecutar el evento en el ledger.
   */
  async marcarProcesado(colaId: string, eventoLedgerId: string, usuarioId?: string): Promise<void> {
    const now = new Date();
    await this.db.tx
      .update(colaSincronizacion)
      .set({
        estado: 'PROCESADO',
        eventoLedgerId,
        procesadoEn: now,
        updatedAt: now,
        updatedBy: usuarioId ?? '00000000-0000-7000-0000-000000000000',
      })
      .where(eq(colaSincronizacion.id, colaId));
  }

  /**
   * Marca una operación como ERROR (fallo en la ejecución del ledger).
   */
  async marcarError(colaId: string, detalle: string, usuarioId?: string): Promise<void> {
    const now = new Date();
    await this.db.tx
      .update(colaSincronizacion)
      .set({
        estado: 'ERROR',
        conflictoDetalle: detalle,
        updatedAt: now,
        updatedBy: usuarioId ?? '00000000-0000-7000-0000-000000000000',
      })
      .where(eq(colaSincronizacion.id, colaId));
  }
}
