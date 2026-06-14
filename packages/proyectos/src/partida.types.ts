import { z } from 'zod';

export const NIVELES_PARTIDA = [1, 2, 3] as const;
export type NivelPartida = (typeof NIVELES_PARTIDA)[number];

const zMonto = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Formato NUMERIC(18,4) esperado: ej. "1250.0000"')
  .nullish();

/**
 * Schema de creación de partida/capítulo.
 * parentId = null → capítulo raíz (nivel 1).
 * parentId = UUID  → hijo del nodo referenciado (nivel padre + 1, máx. 3).
 */
export const zPartidaCreate = z.object({
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(500),
  descripcion: z.string().max(2000).nullish(),
  parentId: z.string().uuid('parentId debe ser UUID').nullish(),
  unidadMedidaId: z.string().uuid('unidadMedidaId debe ser UUID').nullish(),
  cantidadPresupuestada: zMonto,
  precioUnitario: zMonto,
});
export type PartidaCreateInput = z.infer<typeof zPartidaCreate>;

// parentId se omite en update: reparenting no está en scope de esta sesión.
export const zPartidaUpdate = zPartidaCreate.omit({ parentId: true }).partial();
export type PartidaUpdateInput = z.infer<typeof zPartidaUpdate>;

export const zReordenarPartida = z.object({
  nuevaPosicion: z.number().int().min(1, 'La posición mínima es 1'),
});
export type ReordenarPartidaInput = z.infer<typeof zReordenarPartida>;
