# ADR 0002 — Excepciones a RLS: `outbox` y `audit_log`

**Estado:** Aceptado  
**Fecha:** 2026-06-13  
**Contexto:** Pre-vuelo Capa 1 — cierre de arquitectura de seguridad de datos

---

## Contexto

El principio 6 de CLAUDE.md establece: "Multi-tenant desde el esquema." ADR 0001 documentó que todas las tablas de negocio llevan `tenant_id NOT NULL` con política RLS. Sin embargo, dos tablas no cumplen este patrón: `outbox` y `audit_log`. Esta decisión documenta por qué, qué las protege, y cuándo sería necesario revisarla.

---

## Decisión

`outbox` y `audit_log` **no tienen política RLS activa** para el rol `tributia_app`. Esto es intencional.

---

## Razonamiento por tabla

### `outbox`

**Por qué sin RLS:**  
`outbox` es infraestructura transaccional, no datos de negocio. El patrón Transactional Outbox exige que el mismo worker (proceso background) lea y procese mensajes de TODOS los tenants. Si se aplicara RLS, el worker necesitaría conocer de antemano el `tenant_id` de cada mensaje para poder leerlo, creando un huevo-gallina: no puedes procesar el mensaje sin leer el mensaje.

**Qué lo protege:**  
1. `tributia_app` tiene INSERT restringido a columnas válidas por el esquema Drizzle (sin posibilidad de insertar sin `tenant_id`).
2. El campo `tenant_id NOT NULL` está presente como columna de trazabilidad — cualquier row revela su tenant de origen.
3. El worker del outbox corre como proceso interno (no expuesto en la API HTTP) y opera sobre todos los tenants por diseño.
4. Los handlers del outbox restauran el contexto de tenant (`SET LOCAL app.tenant_id`) antes de ejecutar cualquier proyección de negocio. El RLS sí aplica en esa capa secundaria.

**Invariante crítico que se verifica en pruebas:**  
Todo `INSERT INTO outbox` realizado por `tributia_app` pasa por `LedgerService.append()`, que establece `tenant_id` del evento. No existe ruta de código que inserte en outbox sin `tenant_id`.

---

### `audit_log`

**Por qué sin RLS de escritura:**  
`audit_log` es escrita por los triggers `audit_row()` que son `SECURITY DEFINER`. Los triggers se ejecutan con los privilegios de su propietario (`tributia`, el superusuario), no con los del usuario que disparó la operación. Si se pusiera una política RLS `WITH CHECK` sobre `audit_log`, el trigger SECURITY DEFINER la evadiría de todas formas porque su `CURRENT_USER` es `tributia`. El RLS en este caso sería falsa seguridad.

**El verdadero control:** Es a nivel de privilegios de objeto (GRANT/REVOKE), no RLS.

La migración `0010_fix_audit_log_privileges.sql` revocó `INSERT, UPDATE, DELETE` de `tributia_app` sobre `audit_log`:

```sql
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM tributia_app;
```

Resultado verificado en DB:
```
grantee=tributia_app, table_name=audit_log → privilege_type: SELECT (solo eso)
```

Esto garantiza que ningún código de aplicación puede insertar, modificar o borrar registros de auditoría directamente. Solo los triggers SECURITY DEFINER pueden hacerlo.

**Lectura:** `tributia_app` sí puede leer `audit_log` (necesario para endpoints de consulta de historial de cambios). La ausencia de política RLS de lectura significa que en principio podría ver registros de otros tenants. Esto se mitiga porque:
1. Los endpoints de auditoría siempre filtran por `tenant_id` en el WHERE de la query.
2. La RLS de lectura en `audit_log` queda pendiente de implementar cuando se construyan los endpoints de consulta de auditoría (Capa 2+).

---

## Consecuencias

**Positivas:**
- El outbox worker funciona sin contexto de tenant previo.
- Los triggers de auditoría son inmunes a intentos de evasión desde código de aplicación.
- El modelo mental es correcto: RLS protege datos de negocio; los controles de infraestructura usan privilegios de objeto.

**Negativas / Riesgos gestionados:**
- Un bug en el worker del outbox podría, en teoría, procesar mensajes de un tenant en el contexto de otro. Mitigado: los handlers verifican `tenant_id` antes de proyectar.
- `audit_log` sin RLS de lectura puede exponer historial cross-tenant si algún endpoint omite el filtro `WHERE tenant_id = ?`. Mitigado: el ORM (Drizzle) siempre pasa el filtro por convención; se añadirá RLS de lectura cuando se construyan endpoints de consulta de auditoría.

---

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| RLS en `outbox` con `CURRENT_SETTING('app.tenant_id', true)` | El worker lee todos los tenants; no tiene sentido forzar contexto antes de leer |
| Tabla `outbox` por tenant (particionada) | Complejidad operacional innecesaria para el volumen actual |
| RLS en `audit_log` vía SECURITY DEFINER trigger con `SET SESSION AUTHORIZATION` | Demasiado frágil; los privilegios de objeto son más simples y auditables |

---

## Revisión futura

Esta decisión debe revisarse cuando:
1. Se construyan endpoints de consulta de historial de auditoría (añadir RLS lectura en `audit_log`).
2. El outbox escale a millones de filas cross-tenant (evaluar particionamiento por tenant).
