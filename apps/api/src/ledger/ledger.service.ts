import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { type EventoBaseInput, PAYLOAD_SCHEMAS, type TipoEventoConSchema } from '@tributia/ledger';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { eventosOperativos, type EventoOperativoInsert, type EventoOperativoSelect } from '../db/schema/ledger/evento_operativo.js';
import { ProjectionEngineService } from './projection-engine.service.js';

@Injectable()
export class LedgerService {
  constructor(
    private readonly dbService: DbService,
    private readonly projectionEngine: ProjectionEngineService,
  ) {}

  /**
   * Registra un nuevo evento operativo en el ledger dentro de la transacción activa.
   *
   * Idempotente: si ya existe un evento con el mismo idempotency_key, lo devuelve
   * sin insertar duplicado. El llamador no necesita manejar conflictos.
   *
   * Valida el payload contra el schema Zod del tipo_evento cuando esté definido.
   */
  async append(input: EventoBaseInput): Promise<EventoOperativoSelect> {
    if (input.proyectoId == null && input.centroCostoId == null) {
      throw new BadRequestException(
        'Cada evento debe imputarse a un proyecto (proyectoId) o a un centro de costo (centroCostoId).',
      );
    }

    // Validar payload contra el schema del tipo si existe.
    const schema = PAYLOAD_SCHEMAS[input.tipoEvento as TipoEventoConSchema];
    if (schema) {
      const result = schema.safeParse(input.payload);
      if (!result.success) {
        throw new BadRequestException(
          `Payload inválido para tipo_evento '${input.tipoEvento}': ${result.error.message}`,
        );
      }
    }

    const id = newId();
    const values: EventoOperativoInsert = {
      id,
      tenantId: input.tenantId,
      empresaId: input.empresaId,
      proyectoId: input.proyectoId,
      centroCostoId: input.centroCostoId,
      tipoEvento: input.tipoEvento,
      usuarioId: input.usuarioId,
      payload: input.payload,
      referenciaId: input.referenciaId,
      referenciaTabla: input.referenciaTabla,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.usuarioId,
    };

    try {
      const [evento] = await this.dbService.tx
        .insert(eventosOperativos)
        .values(values)
        .returning();

      // Proyecciones síncronas (misma tx → atomicidad) y encolado asíncrono (mismo tx → atomicidad de encolado).
      await this.projectionEngine.runSync(evento!);
      await this.projectionEngine.enqueueAsync(evento!);

      return evento!;
    } catch (err: unknown) {
      // Idempotencia: si la clave ya existe, devolver el evento original.
      if (this.isUniqueViolation(err)) {
        const [existing] = await this.dbService.tx
          .select()
          .from(eventosOperativos)
          .where(eq(eventosOperativos.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * Reversa un evento existente.
   *
   * Pasos dentro de la transacción activa:
   *   1. Verifica que el evento original existe y no está ya reversado.
   *   2. Inserta un evento de tipo 'evento_reversa' que referencia al original.
   *   3. Llama a ledger_marcar_reversado() (SECURITY DEFINER) para marcar el original.
   *
   * Devuelve el evento de reversa recién creado.
   */
  async revertir(
    eventoId: string,
    usuarioId: string,
    motivoPayload: Record<string, unknown> = {},
  ): Promise<EventoOperativoSelect> {
    const [original] = await this.dbService.tx
      .select()
      .from(eventosOperativos)
      .where(eq(eventosOperativos.id, eventoId))
      .limit(1);

    if (!original) {
      throw new NotFoundException(`Evento ${eventoId} no encontrado.`);
    }
    if (original.estado === 'reversado') {
      throw new ConflictException(`El evento ${eventoId} ya está reversado.`);
    }

    // Insertar el evento de reversa.
    const reversaId = newId();
    const [reversa] = await this.dbService.tx
      .insert(eventosOperativos)
      .values({
        id: reversaId,
        tenantId: original.tenantId,
        empresaId: original.empresaId,
        proyectoId: original.proyectoId,
        centroCostoId: original.centroCostoId,
        tipoEvento: 'evento_reversa',
        usuarioId,
        payload: { ...motivoPayload, eventoOriginalId: eventoId, tipoOriginal: original.tipoEvento },
        referenciaId: eventoId,
        referenciaTabla: 'evento_operativo',
        idempotencyKey: `reversa:${eventoId}`,
        createdBy: usuarioId,
      })
      .returning();

    // Marcar el evento original como reversado vía función SECURITY DEFINER.
    await this.dbService.tx.execute(
      sql`SELECT ledger_marcar_reversado(${eventoId}::uuid, ${reversaId}::uuid)`,
    );

    return reversa!;
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as Record<string, unknown>)['code'] === '23505'
    );
  }
}
