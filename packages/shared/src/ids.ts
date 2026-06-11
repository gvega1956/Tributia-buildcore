import { uuidv7 } from 'uuidv7';

export function newId(): string {
  return uuidv7();
}

export type EntityId = string;
export type TenantId = string;
export type EmpresaId = string;
export type ProyectoId = string;
export type UsuarioId = string;
