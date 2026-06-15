import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { partesDiario } from '../db/schema/obra/parte_diario.js';
import { personalParte } from '../db/schema/obra/personal_parte.js';
import { equipoParte } from '../db/schema/obra/equipo_parte.js';
import { avancesObra } from '../db/schema/obra/avance_obra.js';
import { partidas } from '../db/schema/proyectos/partida.js';
import { equiposCatalogo } from '../db/schema/catalogos/equipo_catalogo.js';

const zUUID = z.string().uuid();
const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const zPersonalParteInput = z.object({
  idempotencyKey: z.string().min(1).max(100),
  nombre: z.string().min(1).max(200),
  empleadoId: zUUID.nullable().optional(),
  tipo: z.enum(['PROPIO', 'SUBCONTRATADO']).default('PROPIO'),
  horasTrabajadas: zDecimal,
  partidaId: zUUID,
  tarifaHoraria: zDecimal,
  moneda: z.enum(['DOP', 'USD', 'EUR']).default('DOP'),
});

export const zEquipoParteInput = z.object({
  idempotencyKey: z.string().min(1).max(100),
  equipoId: zUUID,
  horasOperadas: zDecimal,
  partidaId: zUUID,
  observaciones: z.string().max(500).optional(),
  moneda: z.enum(['DOP', 'USD', 'EUR']).default('DOP'),
});

export const zAvanceObraInput = z.object({
  idempotencyKey: z.string().min(1).max(100),
  partidaId: zUUID,
  cantidadEjecutada: zDecimal,
  unidad: z.string().min(1).max(50),
  observaciones: z.string().max(500).optional(),
});

export const zParteDiarioCreateDto = z.object({
  idempotencyKey: z.string().min(1).max(100),
  proyectoId: zUUID,
  empresaId: zUUID,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clima: z.enum(['SOLEADO', 'NUBLADO', 'PARCIALMENTE_NUBLADO', 'LLUVIOSO', 'TORMENTA']).optional(),
  temperaturaC: zDecimal.optional(),
  notas: z.string().max(2000).optional(),
  personal: z.array(zPersonalParteInput).default([]),
  equipos: z.array(zEquipoParteInput).default([]),
  avances: z.array(zAvanceObraInput).default([]),
});

export type ParteDiarioCreateDto = z.infer<typeof zParteDiarioCreateDto>;

@Injectable()
export class ParteDiarioService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Crea un parte diario en estado BORRADOR.
   * Idempotente por (tenantId, idempotencyKey): si ya existe, retorna el existente.
   */
  async crear(
    tenantId: string,
    dto: ParteDiarioCreateDto,
    usuarioId: string,
  ): Promise<string> {
    const now = new Date();

    // Idempotencia: si ya existe con este key, devolver el id sin duplicar
    const [existente] = await this.db.tx
      .select({ id: partesDiario.id, estado: partesDiario.estado })
      .from(partesDiario)
      .where(
        and(
          eq(partesDiario.tenantId, tenantId),
          eq(partesDiario.idempotencyKey, dto.idempotencyKey),
        ),
      )
      .limit(1);

    if (existente) return existente.id;

    const parteId = newId();

    await this.db.tx.transaction(async (tx) => {
      // Cabecera
      await tx.insert(partesDiario).values({
        id: parteId,
        tenantId,
        empresaId: dto.empresaId,
        proyectoId: dto.proyectoId,
        fecha: dto.fecha,
        ...(dto.clima ? { clima: dto.clima } : {}),
        ...(dto.temperaturaC ? { temperaturaC: dto.temperaturaC } : {}),
        ...(dto.notas ? { notas: dto.notas } : {}),
        estado: 'BORRADOR',
        idempotencyKey: dto.idempotencyKey,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      });

      // Líneas de personal
      for (const p of dto.personal) {
        const costoTotal = new Decimal(p.horasTrabajadas).mul(p.tarifaHoraria);
        await tx.insert(personalParte).values({
          id: newId(),
          tenantId,
          parteId,
          nombre: p.nombre,
          ...(p.empleadoId ? { empleadoId: p.empleadoId } : {}),
          tipo: p.tipo,
          horasTrabajadas: p.horasTrabajadas,
          partidaId: p.partidaId,
          tarifaHoraria: p.tarifaHoraria,
          moneda: p.moneda,
          costoTotal: costoTotal.toFixed(4),
          idempotencyKey: p.idempotencyKey,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        });
      }

      // Líneas de equipos — tomar tarifa del catálogo si no se especifica en el DTO
      for (const e of dto.equipos) {
        const [equipo] = await tx
          .select({ tarifaHoraria: equiposCatalogo.tarifaHoraria, nombre: equiposCatalogo.nombre })
          .from(equiposCatalogo)
          .where(eq(equiposCatalogo.id, e.equipoId))
          .limit(1);

        if (!equipo) throw new NotFoundException(`Equipo ${e.equipoId} no encontrado`);

        const costoTotal = new Decimal(e.horasOperadas).mul(equipo.tarifaHoraria);
        await tx.insert(equipoParte).values({
          id: newId(),
          tenantId,
          parteId,
          equipoId: e.equipoId,
          horasOperadas: e.horasOperadas,
          partidaId: e.partidaId,
          tarifaHoraria: equipo.tarifaHoraria,
          moneda: e.moneda,
          costoTotal: costoTotal.toFixed(4),
          ...(e.observaciones ? { observaciones: e.observaciones } : {}),
          idempotencyKey: e.idempotencyKey,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        });
      }

      // Líneas de avance
      for (const a of dto.avances) {
        // Obtener unidad de la partida si el DTO no la especifica (ya la trae)
        await tx.insert(avancesObra).values({
          id: newId(),
          tenantId,
          parteId,
          partidaId: a.partidaId,
          cantidadEjecutada: a.cantidadEjecutada,
          unidad: a.unidad,
          ...(a.observaciones ? { observaciones: a.observaciones } : {}),
          idempotencyKey: a.idempotencyKey,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        });
      }
    });

    return parteId;
  }

  /**
   * Confirma un parte BORRADOR: emite todos los eventos del ledger (avance_partida,
   * hora_personal, hora_equipo) uno por uno dentro de transacciones separadas.
   *
   * Idempotente: si el parte ya está CONFIRMADO, retorna sin error.
   * Cada evento tiene su propio idempotencyKey → el ledger no duplica.
   */
  async confirmar(
    tenantId: string,
    parteId: string,
    usuarioId: string,
  ): Promise<void> {
    const [parte] = await this.db.tx
      .select()
      .from(partesDiario)
      .where(and(eq(partesDiario.tenantId, tenantId), eq(partesDiario.id, parteId)))
      .limit(1);

    if (!parte) throw new NotFoundException(`Parte diario ${parteId} no encontrado`);
    if (parte.estado === 'CONFIRMADO') return; // idempotente
    if (parte.estado !== 'BORRADOR') throw new BadRequestException(`El parte está en estado ${String(parte.estado)}`);

    // Cargar todas las líneas
    const [personal, equipos, avances] = await Promise.all([
      this.db.tx.select().from(personalParte).where(
        and(eq(personalParte.tenantId, tenantId), eq(personalParte.parteId, parteId)),
      ),
      this.db.tx.select().from(equipoParte).where(
        and(eq(equipoParte.tenantId, tenantId), eq(equipoParte.parteId, parteId)),
      ),
      this.db.tx.select().from(avancesObra).where(
        and(eq(avancesObra.tenantId, tenantId), eq(avancesObra.parteId, parteId)),
      ),
    ]);

    // ── Obtener cantidades presupuestadas para el payload de avance ───────────
    const partidaIds = [...new Set(avances.map(a => a.partidaId))];
    const partidasData = partidaIds.length > 0
      ? await this.db.tx.select({
          id: partidas.id,
          cantidadPresupuestada: partidas.cantidadPresupuestada,
        }).from(partidas).where(inArray(partidas.id, partidaIds))
      : [];

    const cantPresMap = new Map<string, string | null>();
    for (const p of partidasData) {
      cantPresMap.set(p.id, p.cantidadPresupuestada);
    }

    // ── Emitir eventos del ledger ──────────────────────────────────────────────
    // Cada ledger.append() ejecuta handlers síncronos en su propia transacción
    const now = new Date();

    // avance_partida por cada línea de avance
    for (const a of avances) {
      if (a.eventoId) continue; // ya emitido en intento anterior (idempotencia)
      const evento = await this.ledger.append({
        tenantId,
        empresaId: parte.empresaId,
        proyectoId: parte.proyectoId,
        centroCostoId: null,
        tipoEvento: 'avance_partida',
        usuarioId,
        referenciaId: parteId,
        referenciaTabla: 'parte_diario',
        idempotencyKey: a.idempotencyKey,
        payload: {
          parteDiarioId: parteId,
          avanceObraId: a.id,
          proyectoId: parte.proyectoId,
          partidaId: a.partidaId,
          cantidadEjecutada: a.cantidadEjecutada,
          unidad: a.unidad,
          ...(cantPresMap.get(a.partidaId)
            ? { cantidadPresupuestada: cantPresMap.get(a.partidaId) }
            : {}),
        },
      });
      await this.db.tx
        .update(avancesObra)
        .set({ eventoId: evento.id, updatedAt: now, updatedBy: usuarioId })
        .where(eq(avancesObra.id, a.id));
    }

    // hora_personal por cada línea de personal
    for (const p of personal) {
      if (p.eventoId) continue;
      const evento = await this.ledger.append({
        tenantId,
        empresaId: parte.empresaId,
        proyectoId: parte.proyectoId,
        centroCostoId: null,
        tipoEvento: 'hora_personal',
        usuarioId,
        referenciaId: parteId,
        referenciaTabla: 'parte_diario',
        idempotencyKey: p.idempotencyKey,
        payload: {
          parteDiarioId: parteId,
          personalParteId: p.id,
          proyectoId: parte.proyectoId,
          partidaId: p.partidaId,
          nombre: p.nombre,
          tipo: p.tipo,
          empleadoId: p.empleadoId ?? null,
          horasTrabajadas: p.horasTrabajadas,
          tarifaHoraria: p.tarifaHoraria,
          moneda: p.moneda,
          costoTotal: p.costoTotal,
        },
      });
      await this.db.tx
        .update(personalParte)
        .set({ eventoId: evento.id, updatedAt: now, updatedBy: usuarioId })
        .where(eq(personalParte.id, p.id));
    }

    // hora_equipo por cada línea de equipo
    for (const e of equipos) {
      if (e.eventoId) continue;
      const [equipo] = await this.db.tx
        .select({ nombre: equiposCatalogo.nombre })
        .from(equiposCatalogo)
        .where(eq(equiposCatalogo.id, e.equipoId))
        .limit(1);

      const evento = await this.ledger.append({
        tenantId,
        empresaId: parte.empresaId,
        proyectoId: parte.proyectoId,
        centroCostoId: null,
        tipoEvento: 'hora_equipo',
        usuarioId,
        referenciaId: parteId,
        referenciaTabla: 'parte_diario',
        idempotencyKey: e.idempotencyKey,
        payload: {
          parteDiarioId: parteId,
          equipoParteId: e.id,
          proyectoId: parte.proyectoId,
          partidaId: e.partidaId,
          equipoId: e.equipoId,
          nombreEquipo: equipo?.nombre ?? 'Equipo',
          horasOperadas: e.horasOperadas,
          tarifaHoraria: e.tarifaHoraria,
          moneda: e.moneda,
          costoTotal: e.costoTotal,
        },
      });
      await this.db.tx
        .update(equipoParte)
        .set({ eventoId: evento.id, updatedAt: now, updatedBy: usuarioId })
        .where(eq(equipoParte.id, e.id));
    }

    // Marcar el parte como CONFIRMADO
    await this.db.tx
      .update(partesDiario)
      .set({ estado: 'CONFIRMADO', updatedAt: now, updatedBy: usuarioId })
      .where(eq(partesDiario.id, parteId));
  }

  async findAll(tenantId: string, proyectoId?: string) {
    const query = this.db.tx
      .select()
      .from(partesDiario)
      .where(
        proyectoId
          ? and(eq(partesDiario.tenantId, tenantId), eq(partesDiario.proyectoId, proyectoId))
          : eq(partesDiario.tenantId, tenantId),
      );
    return query;
  }

  async findById(tenantId: string, parteId: string) {
    const [parte] = await this.db.tx
      .select()
      .from(partesDiario)
      .where(and(eq(partesDiario.tenantId, tenantId), eq(partesDiario.id, parteId)))
      .limit(1);

    if (!parte) throw new NotFoundException(`Parte diario ${parteId} no encontrado`);

    const [personal, equipos, avances] = await Promise.all([
      this.db.tx.select().from(personalParte).where(
        and(eq(personalParte.tenantId, tenantId), eq(personalParte.parteId, parteId)),
      ),
      this.db.tx.select().from(equipoParte).where(
        and(eq(equipoParte.tenantId, tenantId), eq(equipoParte.parteId, parteId)),
      ),
      this.db.tx.select().from(avancesObra).where(
        and(eq(avancesObra.tenantId, tenantId), eq(avancesObra.parteId, parteId)),
      ),
    ]);

    return { ...parte, personal, equipos, avances };
  }
}
