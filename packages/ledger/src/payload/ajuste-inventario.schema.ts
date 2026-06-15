import { z } from 'zod';
import { zUUID, zMoney } from '@tributia/shared';

const zDecimal = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Debe ser decimal con hasta 4 decimales');

export const MOTIVOS_AJUSTE = ['CONTEO_FISICO', 'MERMA', 'DAÑO', 'ERROR_CAPTURA', 'OTRO'] as const;
export type MotivoAjuste = (typeof MOTIVOS_AJUSTE)[number];

export const zPayloadAjusteInventario = z.object({
  almacenId: zUUID,
  insumoId: zUUID,
  cantidadSistema: zDecimal,
  cantidadFisica: zDecimal,
  unidad: z.string().min(1).max(20),
  motivo: z.enum(MOTIVOS_AJUSTE),
  costoUnitario: zMoney,
});

export type PayloadAjusteInventario = z.infer<typeof zPayloadAjusteInventario>;
