/**
 * Verificación de integridad de e-CF y acuses (§22 arquitectura.md:
 * "Retención documental fiscal: e-CF y acuses conservados los plazos que
 * exige la norma, con verificación de integridad.").
 *
 * Determinista y sin I/O: dado el mismo payload, siempre el mismo hash.
 */
import { createHash } from 'node:crypto';

/** Serializa de forma estable (claves ordenadas) para que el hash sea reproducible. */
function serializarEstable(payload: unknown): string {
  return JSON.stringify(payload, (_key: string, value: unknown): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const original = value as Record<string, unknown>;
      const ordenado: Record<string, unknown> = {};
      for (const clave of Object.keys(original).sort()) {
        ordenado[clave] = original[clave];
      }
      return ordenado;
    }
    return value;
  });
}

/** Calcula el hash SHA-256 (hex) de un documento o acuse para verificación de integridad. */
export function calcularHashIntegridad(payload: unknown): string {
  return createHash('sha256').update(serializarEstable(payload)).digest('hex');
}

/** Verifica que un payload no haya sido alterado desde que se calculó su hash. */
export function verificarIntegridad(payload: unknown, hash: string): boolean {
  return calcularHashIntegridad(payload) === hash;
}
