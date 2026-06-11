# CLAUDE.md — Constitución del Proyecto Tributia BuildCore

Este archivo es ley. Toda sesión de trabajo, todo código generado y toda decisión técnica debe respetarlo. Si una tarea pide violar algo de aquí, detente y pregunta antes de continuar.

## Nombre oficial y convención

- **Marca (documentos, interfaz, textos):** Tributia BuildCore
- **Identificador técnico (repo, slug, dominios):** `tributia-buildcore`
- **Scope de paquetes npm:** `@tributia/core`, `@tributia/ledger`, `@tributia/contabilidad`, etc.
- Nunca usar variantes ("BuildCore" solo, "TBC", "Tributia-Build-Core") en código o documentación.

## Qué es este proyecto

Tributia BuildCore: plataforma operativa integral para empresas constructoras (República Dominicana primero, luego región). SaaS multi-tenant. La arquitectura completa está en `docs/arquitectura.md` — **léela antes de diseñar cualquier módulo nuevo**.

Tesis del producto: **"Un hecho, un registro, todas las consecuencias automáticas."**
Todo hecho operativo se registra UNA vez como evento inmutable; inventario, costos, contabilidad y KPIs son proyecciones derivadas. Nunca se digita el mismo dato dos veces. Nunca hay dos versiones de la misma verdad.

## Stack (fijo — no proponer alternativas salvo bloqueo real)

- **Lenguaje:** TypeScript estricto (`strict: true`, sin `any` salvo justificación comentada)
- **Backend:** Node.js + NestJS (monolito modular)
- **Base de datos:** PostgreSQL 16+ con Row Level Security para multi-tenancy
- **ORM/Migraciones:** Drizzle ORM (SQL explícito, migraciones versionadas en repo)
- **Validación:** Zod en toda frontera (API, eventos, importadores)
- **Pruebas:** Vitest (+ Supertest para e2e de API)
- **Colas/async:** patrón transactional outbox en Postgres; BullMQ cuando haga falta worker
- **Monorepo:** pnpm workspaces (`apps/`, `packages/`)
- **API:** REST con OpenAPI generado; versionada (`/api/v1`)

## Los 10 principios de arquitectura (resumen operativo)

1. **Una sola BD, un solo modelo.** Los módulos NO se integran entre sí: comparten esquema y se comunican por eventos e interfaces públicas. Prohibido que un módulo lea tablas internas de otro.
2. **Event Ledger es la columna vertebral.** Todo hecho de negocio → fila inmutable en `evento_operativo`. Las proyecciones (inventario, costo, contabilidad, KPI) derivan de ahí. Nada actualiza una proyección directamente.
3. **Todo costo tiene imputación.** Proyecto+partida o centro de costo administrativo. NOT NULL a nivel de esquema. No existe el costo huérfano.
4. **Contabilidad por reglas.** Cada tipo de evento tiene regla contable parametrizable que genera su asiento de partida doble. Asientos manuales solo para ajustes, siempre auditados.
5. **La partida (EDT) es el lenguaje común** entre presupuesto, compras, consumo, avance, costo y facturación. Misma entidad, sin re-mapeos.
6. **Multi-tenant/multi-empresa/multi-moneda/multi-país desde el esquema.** Localización fiscal = paquete enchufable (`packages/localizacion-do` primero). Nada de RD incrustado en el núcleo.
7. **El campo funciona offline** (aplica a la app móvil; el API debe soportar sincronización idempotente con claves de deduplicación).
8. **Nada se borra.** Soft-delete o contra-evento de reversa. Toda tabla tiene `created_at`, `created_by`, `updated_at`, `updated_by`. Auditoría de cambios en tablas sensibles.
9. **Permisos = rol × proyecto × empresa.** Toda ruta del API declara su permiso requerido. Sin rutas "abiertas por ahora".
10. **API-first.** Toda capacidad existe primero como endpoint documentado y probado.

## Reglas de datos (innegociables)

- **Tenancy:** toda tabla de negocio lleva `tenant_id` NOT NULL con política RLS. La conexión por request ejecuta `SET LOCAL app.tenant_id = ...` dentro de transacción. PROHIBIDO filtrar tenant solo en código de aplicación.
- **Dinero:** `NUMERIC(18,4)` en BD; en TS usar decimal.js (nunca `number` para montos). Moneda explícita en cada monto (`monto`, `moneda`). Tasa de cambio registrada en el evento, no consultada después.
- **Fechas:** `timestamptz` en UTC. La zona horaria es problema de presentación. Fechas de negocio sin hora (vencimientos, períodos) usan `date`.
- **IDs:** UUID v7 (ordenables por tiempo).
- **Identificadores de dominio en español sin acentos** (`Partida`, `Cubicacion`, `OrdenCompra`, `AsientoContable`); infraestructura técnica en inglés (`EventBus`, `ProjectionEngine`). El lenguaje ubicuo del dominio es el de la industria dominicana — no traducir conceptos como e-CF, partida, cubicación, NCF.
- **Migraciones:** solo aditivas en lo posible; toda migración destructiva requiere plan de reversa escrito en el PR.
- **Catálogos DGII versionados** con vigencia (`valido_desde`, `valido_hasta`) — la DGII los cambia.

## Reglas del Event Ledger

- `evento_operativo` es **append-only**: sin UPDATE ni DELETE (forzado con trigger). Corrección = evento de reversa que referencia al original.
- Todo evento lleva: `tipo_evento` (de catálogo cerrado en código), `tenant_id`, `empresa_id`, `proyecto_id`/`centro_costo_id`, referencia al documento origen, `payload` validado con Zod por tipo, e `idempotency_key` única (sincronización móvil segura).
- **Proyecciones síncronas** (misma transacción): inventario, comprometido/devengado de presupuesto. **Asíncronas** (outbox): KPIs, notificaciones, BI.
- Cada tipo de evento nuevo nace con: schema Zod + handler(s) de proyección + regla contable (o exención explícita) + pruebas que verifiquen el asiento exacto que produce.

## Estructura del monorepo

```
tributia-buildcore/
├── CLAUDE.md
├── docs/
│   ├── arquitectura.md          # documento maestro v1.0
│   └── decisiones/              # ADRs: una decisión = un archivo numerado
├── apps/
│   └── api/                     # NestJS — composición de módulos, sin lógica de negocio
├── packages/
│   ├── core/                    # tenancy, identidad, permisos, auditoría
│   ├── ledger/                  # evento_operativo, bus, motor de proyecciones, outbox
│   ├── contabilidad/            # plan de cuentas, motor de reglas, asientos
│   ├── catalogos/               # terceros, insumos, equipos, planes de cuenta plantilla
│   ├── proyectos/               # proyecto, EDT, partidas, APU, presupuesto
│   ├── compras/                 # requisición → OC → recepción → factura proveedor
│   ├── inventario/              # almacenes, movimientos, kárdex
│   ├── obra/                    # parte diario, avance, RFI, cronograma
│   ├── workflow/                # motor de flujos de aprobación
│   ├── documental/              # archivos, versiones, vencimientos
│   ├── localizacion-do/         # e-CF (adaptador al middleware), 606/607, retenciones, TSS
│   └── shared/                  # tipos, dinero, fechas, errores, Zod utils
└── tools/                       # scripts, seeds, generadores
```

**Frontera de módulos:** cada package expone SOLO su `index.ts` público. Importar rutas internas de otro package está prohibido (regla ESLint `no-restricted-imports` lo refuerza). Comunicación entre módulos: eventos del ledger o interfaces públicas inyectadas.

## Calidad y pruebas

- **Ninguna funcionalidad está terminada sin pruebas.** Mínimo: unit del dominio + prueba del asiento contable si emite eventos + e2e del endpoint.
- Los motores (proyecciones, reglas contables, RLS) requieren pruebas de propiedad: "para todo evento de tipo X, débitos = créditos", "ninguna consulta sin tenant_id devuelve filas".
- `pnpm lint && pnpm typecheck && pnpm test` debe pasar antes de cada commit. Si no pasa, el commit no se hace.
- Seeds realistas en `tools/seeds` (una constructora demo con un proyecto, EDT y catálogos RD).

## Flujo de trabajo

- Una rama por funcionalidad: `feat/ledger-eventos`, `fix/rls-empresa`. Commits pequeños, mensajes en español, formato `tipo: descripción`.
- Toda decisión arquitectónica nueva (o desviación de este archivo) se documenta como ADR en `docs/decisiones/` ANTES de implementarse.
- Cambios normativos DGII tienen prioridad absoluta sobre cualquier feature.

## Lo que NUNCA debes hacer

- Crear una tabla de negocio sin `tenant_id` + RLS + columnas de auditoría.
- Actualizar inventario, costos o contabilidad sin pasar por un evento del ledger.
- Usar `number` para dinero, `Date` sin timezone explícito, o `any`.
- Hacer que un módulo importe internals de otro.
- Implementar "rápido y luego lo arreglamos" en el núcleo (Capa 0). El núcleo se hace bien o no se hace.
- Borrar datos físicamente o saltarte las pruebas para avanzar.
- Incrustar lógica fiscal dominicana fuera de `packages/localizacion-do`.

## Definición de "terminado" (Definition of Done)

1. Código + pruebas pasando + typecheck + lint limpios.
2. Endpoint documentado en OpenAPI (si aplica).
3. Migración versionada (si aplica) y seed actualizado.
4. Si emite eventos: regla contable definida y probada con el asiento exacto.
5. ADR escrito si hubo decisión de diseño.
6. Commit en su rama con mensaje claro.
