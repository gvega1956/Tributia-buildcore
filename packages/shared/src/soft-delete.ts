/**
 * Utilidades de soft-delete estándar (P8 — Nada se borra).
 *
 * Uso:
 *   await db.update(usuarios)
 *     .set(softDeleteValues(userId))
 *     .where(eq(usuarios.id, id));
 *
 *   // En queries, filtrar registros activos:
 *   .where(isActive(usuarios))
 */

/** Campos que toda tabla soft-deleteable debe tener. */
export type SoftDeletableFields = {
  deletedAt?: Date | null;
  deletedBy?: string | null;
};

/**
 * Retorna los valores a asignar en un UPDATE de soft-delete.
 * Puro TypeScript, sin dependencia de Drizzle — aplicar con `.set()`.
 */
export function softDeleteValues(deletedBy: string): { deletedAt: Date; deletedBy: string } {
  return { deletedAt: new Date(), deletedBy };
}

/**
 * Retorna los campos de restauración de un soft-delete.
 * Útil para un "undelete" administrativo (requiere permiso explícito).
 */
export function restoreValues(updatedBy: string): { deletedAt: null; deletedBy: null; updatedBy: string; updatedAt: Date } {
  return { deletedAt: null, deletedBy: null, updatedBy, updatedAt: new Date() };
}

/**
 * Type guard: verdadero si el registro no ha sido borrado lógicamente.
 * Usar en lógica de aplicación, no en queries (usar isNull de Drizzle para eso).
 */
export function isNotSoftDeleted(record: SoftDeletableFields): boolean {
  return record.deletedAt == null;
}
