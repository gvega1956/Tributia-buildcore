import type { TipoEvento } from '../tipos-evento.js';

export type EstadoEvento = 'registrado' | 'validado' | 'contabilizado' | 'reversado';

export interface EventoOperativo {
  id: string;
  tenantId: string;
  empresaId: string;
  proyectoId: string | null;
  centroCostoId: string | null;
  tipoEvento: TipoEvento;
  timestamp: Date;
  usuarioId: string;
  payload: Record<string, unknown>;
  referenciaId: string | null;
  referenciaTabla: string | null;
  idempotencyKey: string;
  estado: EstadoEvento;
  eventoReversaId: string | null;
  createdAt: Date;
  createdBy: string;
}
