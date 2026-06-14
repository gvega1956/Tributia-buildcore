import { z } from 'zod';

export type CategoriaEquipo =
  | 'MAQUINARIA_PESADA'
  | 'VEHICULO_LIVIANO'
  | 'VEHICULO_PESADO'
  | 'HERRAMIENTA_MAYOR'
  | 'PLANTA_ELECTRICA'
  | 'BOMBA'
  | 'OTRO';

export const zEquipoCatalogoCreate = z.object({
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(500).nullable().default(null),
  categoria: z
    .enum([
      'MAQUINARIA_PESADA',
      'VEHICULO_LIVIANO',
      'VEHICULO_PESADO',
      'HERRAMIENTA_MAYOR',
      'PLANTA_ELECTRICA',
      'BOMBA',
      'OTRO',
    ])
    .default('OTRO'),
  tarifaHoraria: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Tarifa debe ser decimal positivo con hasta 4 decimales'),
  monedaTarifa: z.enum(['DOP', 'USD', 'EUR']).default('DOP'),
});

export const zEquipoCatalogoUpdate = zEquipoCatalogoCreate.partial().omit({ codigo: true });

export type EquipoCatalogoCreateInput = z.infer<typeof zEquipoCatalogoCreate>;
export type EquipoCatalogoUpdateInput = z.infer<typeof zEquipoCatalogoUpdate>;
