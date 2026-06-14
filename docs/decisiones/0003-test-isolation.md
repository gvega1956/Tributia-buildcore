# ADR 0003 — Estrategia de aislamiento de pruebas de integración

**Estado:** Aceptado  
**Fecha:** 2026-06-13  
**Contexto:** Pre-vuelo Capa 1 — protocolo de pruebas para tablas con inmutabilidad forzada

---

## Contexto

Tributia BuildCore tiene varias categorías de tablas que bloquean activamente los `DELETE`:

1. **Tablas con `prevent_delete` trigger** (`tenant`, `empresa`, `usuario`, `rol`, `sucursal`, `centro_costo`): cualquier `DELETE` lanza el error PG `23001` como medida de protección operativa (principio 8 de CLAUDE.md: "nada se borra").
2. **Tablas append-only** (`evento_operativo`): tienen el trigger `enforce_append_only` que bloquea `UPDATE` y `DELETE`, más una política RLS que filtra por `tenant_id`.
3. **Tablas de auditoría** (`audit_log`): `tributia_app` no tiene `DELETE` (revocado en migración 0010). Solo `tributia` (superusuario) puede borrar.

Esto hace imposible el patrón de cleanup habitual en pruebas de integración (`afterAll: DELETE FROM tabla WHERE id = ?`).

---

## Decisión

**Los tests de integración usan datos de prueba aislados por `tenant_id` único por ejecución.** La limpieza post-test emplea el patrón `DISABLE TRIGGER / DELETE / ENABLE TRIGGER` ejecutado como el usuario `tributia` (superusuario, propietario de la tabla).

---

## Patrón de aislamiento (en detalle)

### Crear un tenant único por ejecución

```typescript
const SLUG = `test-<módulo>-${Date.now()}`;
const tenantId = newId();

await adminDb.insert(schema.tenants).values({ id: tenantId, slug: SLUG, ... });
```

`Date.now()` garantiza que dos ejecuciones paralelas no colisionen. Todo fixture de prueba lleva `tenant_id = tenantId`, por lo que está aislado en RLS.

### Eliminar con DISABLE TRIGGER

```typescript
// afterAll — usuario tributia (adminPool) puede deshabilitar triggers
await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
await adminPool.query(`DELETE FROM empresa WHERE tenant_id = $1`, [tenantId]);
await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
```

**El DISABLE TRIGGER siempre va en pareja con ENABLE TRIGGER** en el mismo script de limpieza, para no dejar el trigger deshabilitado si el test falla a mitad. El orden correcto es: deshabilitar → borrar → habilitar, dentro del mismo `afterAll`.

**Alternativa equivalente para borrar una sola fila conocida** (inline cleanup dentro del test):

```typescript
await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
await adminPool.query(`DELETE FROM empresa WHERE id = $1`, [empId]);
await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
```

### Tablas sin `prevent_delete` — limpieza directa

Algunas tablas no tienen el trigger de bloqueo y pueden limpiarse directamente:
- `refresh_token` — se puede `DELETE WHERE tenant_id = ?`
- `usuario_rol_empresa` — se puede `DELETE WHERE tenant_id = ?`
- `rol_permiso` — se puede `DELETE WHERE rol_id = ANY(?)`
- `outbox` — se puede `DELETE WHERE tenant_id = ?` (infraestructura)

### `evento_operativo` y `audit_log` — no limpiar

Las pruebas sobre estas tablas **no intentan limpiar sus filas**. Los datos de prueba quedan en la BD con el `tenant_id` del test. Dado que el tenant de prueba es único por ejecución y su SLUG incluye timestamp, no interfieren con otras pruebas.

Esto es correcto por diseño: en producción, estos datos tampoco se borran.

---

## Orden correcto de limpieza (referencia canónica)

El `afterAll` siempre limpia en orden inverso a las FK:

```
refresh_token          (sin trigger)
usuario_rol_empresa    (sin trigger)
rol_permiso            (sin trigger)
rol                    → DISABLE no_delete_rol → DELETE → ENABLE
usuario                → DISABLE no_delete_usuario → DELETE → ENABLE
empresa                → DISABLE no_delete_empresa → DELETE → ENABLE
tenant                 → DISABLE no_delete_tenant → DELETE → ENABLE
```

Otras tablas que aparecen en tests específicos:
```
insumo / unidad_medida / tercero / equipo / archivo ...
  → verificar si tienen no_delete_* antes de borrar
  → si tienen el trigger: DISABLE → DELETE → ENABLE
  → si no tienen: DELETE directamente
```

---

## Por qué NO usar otras estrategias

| Estrategia | Por qué se descarta |
|---|---|
| Transactions por test (rollback al final) | Los tests de integración hacen múltiples conexiones y requieren `COMMIT` para verificar persistencia real. El rollback invisibiliza el comportamiento transaccional que se quiere probar. |
| Datos fijos pre-insertados (fixtures de BD) | Los datos fijos se corrompen entre ejecuciones si un test modifica estado. `tenant_id` por ejecución es más robusto. |
| Test containers (PostgreSQL en Docker por suite) | Añade dependencia de Docker y duplica el tiempo de arranque. La BD nativa en D:\PostgreSQL\16 es más rápida y ya existe. |
| Truncate RESTART IDENTITY CASCADE | Borra datos de otros tests que corren en paralelo. Peligroso en suites concurrentes. |
| Soft-delete (marcar isActive=false) | No aplica: el objetivo es eliminar artefactos de prueba, no modelar borrado de negocio. Los triggers de protect_delete son de seguridad, no de negocio. |

---

## Cómo aplicar en tests de Capa 1

Cada nuevo test de integración debe:

1. Generar `tenantId = newId()` y `SLUG = 'test-<módulo>-${Date.now()}'` en `beforeAll`.
2. Insertar todos los fixtures con ese `tenantId`.
3. En `afterAll`: seguir el orden de limpieza de arriba, usando `DISABLE TRIGGER` donde sea necesario.
4. Si una nueva tabla tiene `prevent_delete`, añadirla a esta lista con su nombre de trigger.

La consulta para descubrir los triggers activos:

```sql
SELECT tgname, relname
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE tgname LIKE 'no_delete_%'
ORDER BY relname;
```

Resultado actual (migración 0000–0010):
```
no_delete_centro_costo | centro_costo
no_delete_empresa      | empresa
no_delete_rol          | rol
no_delete_sucursal     | sucursal
no_delete_tenant       | tenant
no_delete_usuario      | usuario
```

---

## Consecuencias

**Positivas:**
- Los tests de integración verifican comportamiento real de BD (triggers, RLS, constraints).
- El tenant único por ejecución garantiza aislamiento sin necesidad de truncar.
- El patrón DISABLE/ENABLE es explícito y auditado en el código del test.

**Negativas / Riesgos gestionados:**
- Los `evento_operativo` y `audit_log` acumulan filas de tests (no se limpian). Mitigado: el tenant test tiene un SLUG único con timestamp — no interfiere con datos de producción.
- Un fallo en `afterAll` antes del `ENABLE TRIGGER` dejaría el trigger deshabilitado. Mitigado: usar una transacción explícita en el bloque DISABLE/DELETE/ENABLE si la suite es especialmente crítica.
