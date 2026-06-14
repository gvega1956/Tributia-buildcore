import { z } from 'zod';

export interface FilaError {
  fila: number;
  campo?: string;
  error: string;
  valorRecibido?: unknown;
}

export interface ImportacionResult<T = unknown> {
  totalFilas: number;
  procesadas: number;
  omitidas: number;
  errores: FilaError[];
  simulacion: boolean;
  datos?: T[];
}

export const zOpcionesImportacion = z.object({
  simulacion: z.coerce.boolean().default(false),
});

export type OpcionesImportacion = z.infer<typeof zOpcionesImportacion>;
