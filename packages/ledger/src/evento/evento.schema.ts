import { z } from 'zod';
import { zUUID, zEntityId } from '@tributia/shared';
import { TIPOS_EVENTO } from '../tipos-evento.js';

export const zEventoBase = z.object({
  tenantId: zUUID,
  empresaId: zUUID,
  proyectoId: zUUID.nullable(),
  centroCostoId: zUUID.nullable(),
  tipoEvento: z.enum(TIPOS_EVENTO),
  usuarioId: zUUID,
  payload: z.record(z.unknown()),
  referenciaId: zEntityId.nullable(),
  referenciaTabla: z.string().max(100).nullable(),
  idempotencyKey: z.string().min(1).max(255),
});

export type EventoBaseInput = z.infer<typeof zEventoBase>;
