# ADR 0001 — Aislamiento multi-tenant: Row Level Security + rol de aplicación

**Estado:** Aceptado  
**Fecha:** 2026-06-10  
**Contexto:** Sesión 2 Capa 0

---

## Contexto

Tributia BuildCore es SaaS multi-tenant. Cada constructora (tenant) debe ver **únicamente** sus propios datos,
incluso si el código de aplicación omite un filtro `WHERE`. El aislamiento no puede depender de la disciplina
del programador: debe ser estructural e imposible de saltar por error.

## Opciones consideradas

| Opción | Descripción | Problema principal |
|--------|-------------|-------------------|
| **A. Filtro en código** | Cada query lleva `WHERE tenant_id = ?` | Un olvido expone datos de todos los tenants |
| **B. Schema separado por tenant** | Cada tenant tiene su propio schema PostgreSQL | Operaciones cross-tenant imposibles; migraciones O(n) por tenant |
| **C. BD separada por tenant** | Una base de datos por constructora | Costo operativo prohibitivo; imposible para el tamaño del mercado objetivo |
| **D. RLS + rol de aplicación (elegida)** | Política a nivel de motor que filtra por `app.tenant_id` | Ver trade-offs abajo |

## Decisión

Se usa **PostgreSQL Row Level Security (RLS)** con un rol de aplicación dedicado:

### Dos roles de base de datos

| Rol | Uso | RLS |
|-----|-----|-----|
| `tributia` | Migraciones, seeds, operaciones admin | **Dueño de tablas → bypassa RLS automáticamente** |
| `tributia_app` | Runtime de la aplicación | **Sujeto a RLS en todas las tablas de negocio** |

### Mecanismo por request

1. El `TenancyInterceptor` de NestJS extrae el `tenant_id` del JWT (Sesión 3) o del header `X-Tenant-Id` (provisional).
2. Abre una transacción en la conexión `tributia_app`.
3. Ejecuta `SET LOCAL app.tenant_id = '<uuid>'` — efecto limitado a esa transacción.
4. Deposita la transacción en `AsyncLocalStorage` para que los servicios la usen sin prop-drilling.
5. Al terminar el handler, la transacción hace COMMIT (o ROLLBACK si hay error).

### Política RLS

```sql
-- Función helper (en init.sql)
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Política en cada tabla de negocio
CREATE POLICY tenant_isolation ON empresa
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
```

**Comportamiento garantizado por el motor:**
- `app_tenant_id()` retorna NULL → `tenant_id = NULL` → falso → **0 filas devueltas**
- `app_tenant_id()` retorna UUID → solo las filas de ese tenant son visibles/modificables
- Rol `tributia` → bypassa RLS → puede operar sobre todos los tenants (migraciones, seeds)

## Consecuencias

**Positivas:**
- Aislamiento imposible de saltar desde código de aplicación (el motor lo fuerza).
- Los tests prueban esto directamente contra PostgreSQL real; no es posible que un mock lo simule.
- `tributia` bypassa RLS: las migraciones no necesitan tenant_id.
- Un solo schema, una sola base de datos → operativo simple y económico.

**Trade-offs aceptados:**
- Cada request abre y cierra una transacción aunque sea solo-lectura. Overhead aceptable para este dominio.
- `AsyncLocalStorage` es la única forma de propagar la transacción sin modificar firmas de todos los servicios.
- El rol `tributia_app` necesita `GRANT` explícito en cada tabla nueva; esto se hace en las migraciones.

## Regla derivada para todo el proyecto

> Toda tabla de negocio (cualquier tabla que no sea `tenant` ni tablas de sistema) debe tener:
> 1. Columna `tenant_id UUID NOT NULL REFERENCES tenant(id)`
> 2. `ALTER TABLE t ENABLE ROW LEVEL SECURITY`
> 3. `CREATE POLICY tenant_isolation ON t USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())`
> 4. `GRANT SELECT, INSERT, UPDATE, DELETE ON t TO tributia_app`
>
> Esta regla se verifica automáticamente en la Sesión 12 (auditoría de Capa 0).

## Referencias

- PostgreSQL 16 docs: Row Security Policies
- `packages/core/src/db/schema/` — definiciones TypeScript de las tablas
- `apps/api/src/db/migrations/0000_tenancy.sql` — migración con DDL + RLS
- `apps/api/src/database/tenancy.interceptor.ts` — implementación del interceptor
