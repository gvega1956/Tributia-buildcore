import { randomUUID } from 'crypto';

// UUID v7 — time-ordered UUIDs
// Using a simple implementation until a proper uuid v7 library is set up
export function newId(): string {
  // Generate a time-prefixed UUID v7-like identifier
  // Format: timestamp_ms (48 bits) + version (4 bits) + random
  const now = Date.now();
  const timeHex = now.toString(16).padStart(12, '0');
  const uuid = randomUUID().replace(/-/g, '');
  // Build a UUID v7-like string
  const v7 = [
    timeHex.slice(0, 8),
    timeHex.slice(8, 12),
    '7' + uuid.slice(1, 4),
    uuid.slice(4, 8),
    uuid.slice(8, 20),
  ].join('-');
  return v7;
}

export type EntityId = string;
export type TenantId = string;
export type EmpresaId = string;
export type ProyectoId = string;
export type UsuarioId = string;
