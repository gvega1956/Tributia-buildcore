# ADR-0006 — Qué significa "avance aprobado" para la Cubicación

**Estado:** Aceptado
**Fecha:** 2026-06-16
**Autores:** Equipo Tributia BuildCore

---

## Contexto

La Sesión 3 de Capa 2 (CxC y Cubicaciones) pidió: "toma el avance físico APROBADO por partida (que ya existe desde Capa 1 obra) y produce una certificación facturable por período."

Al revisar el código de Capa 1 Obra (`ObraAvancePartidaHandler`, `ejecucion_partida.avance_cantidad`) se confirmó que **no existe ningún estado o flujo de "aprobación" de avance**. El único uso de la palabra "aprobado" en el módulo de obra es un comentario sobre el *presupuesto BASE aprobado* (Sesión 3 Capa 1), no sobre el avance físico. El avance se registra directamente vía el evento `avance_partida` y se proyecta de forma síncrona a `ejecucion_partida.avance_cantidad`; solo genera alertas no bloqueantes cuando excede la cantidad vigente.

Esto crea una discrepancia entre la premisa de la sesión y el estado real del repositorio.

---

## Decisión

**"Avance aprobado" = `ejecucion_partida.avance_cantidad`**, es decir, el acumulado de todos los eventos `avance_partida` registrados en el ledger para esa partida.

No se construye ningún flujo de aprobación nuevo (sin estado `pendiente`/`aprobado` en `avance_obra`, sin paso de workflow).

**Razón:** el Principio 2 de la arquitectura establece que el Event Ledger es la columna vertebral — un evento `avance_partida` ya es, por construcción, un hecho operativo inmutable registrado por el responsable de campo (parte diario). No existe ambigüedad de "borrador vs. aprobado": el hecho de que esté en el ledger ES la aprobación. Introducir un estado de aprobación adicional duplicaría la fuente de verdad (P-tesis: "un hecho, un registro") y no fue solicitado en ninguna sesión anterior de Capa 1.

El control real que la sesión pide — "la cubicación no puede facturar más avance del aprobado" — se traduce directamente en: **la cantidad acumulada certificada en cubicaciones (`cubicacion_linea.cantidad_acumulada`) nunca puede superar `ejecucion_partida.avance_cantidad`**. Esta validación se implementa en `CubicacionService.crear()` y es la que se prueba en los tests de integración.

---

## Alternativas consideradas

### Alternativa A: Nuevo estado `aprobado` en `avance_obra` con flujo de aprobación
Agregar un campo `estado_aprobacion` y un endpoint de aprobación, posiblemente integrado al motor de `workflow`.

**Rechazada** porque: (a) no fue solicitado en ninguna sesión de Capa 1 ni en el cierre de Capa 1 (`project_sesion11_capa1_auditoria` — Capa 1 quedó cerrada); (b) introduce un estado de borrador para un hecho operativo que ya es inmutable por el ledger, contradiciendo P2; (c) es una sesión completa por sí misma (workflow + UI de aprobación de campo) que desvía el foco de esta sesión, que es el ciclo de ingresos.

### Alternativa B (adoptada): Avance acumulado del ledger es la única fuente de "aprobado"
Sin cambios al módulo de obra. La cubicación lee `ejecucion_partida.avance_cantidad` directamente.

---

## Consecuencias

**Positivas:**
- Cero cambios al módulo de obra (Capa 1, ya cerrada y auditada).
- El control de negocio central queda en un solo lugar: la validación de tope en `CubicacionService`.
- Compatible con que, en una sesión futura, se agregue un paso de aprobación explícito de avance (campo → oficina técnica) sin romper esta sesión: simplemente se restringiría qué eventos `avance_partida` cuentan hacia `avance_cantidad`.

**Negativas:**
- Si en el futuro la constructora necesita un paso de revisión humana entre "avance reportado por el capataz" y "avance facturable", esto requerirá una sesión adicional (workflow de aprobación de avance) — no cubierta aquí.

---

## Implementación

- `apps/api/src/cxc/cubicacion.service.ts` — valida `cantidad_acumulada <= ejecucion_partida.avance_cantidad` por partida.
- Sin cambios en `apps/api/src/obra/`.
