# ADR-0009 — Flujo de Caja Proyectado: on-the-fly, semanas, y fuentes de datos

**Estado:** Aceptado  
**Fecha:** 2026-06-16  
**Sesión:** Sesión 6 Capa 2

---

## Contexto

La sesión 6 Capa 2 implementó el flujo de caja proyectado por proyecto (§16). La pregunta que responde: *"¿puedo sostener esta obra sin ahogarme?"* El módulo agrega cobros esperados contra pagos comprometidos, semana a semana, a lo largo de un horizonte configurable (default 13 semanas = trimestre).

---

## Decisión 1 — On-the-fly vs proyección materializada (outbox)

### Alternativas

| Opción | Descripción |
|--------|-------------|
| **A — On-the-fly (elegida)** | El servicio consulta en tiempo real las tablas de CxC, cubicacion_proyectada, OC y programacion_pago. Cada llamada al endpoint regenera la proyección. |
| B — Proyección materializada (outbox) | Un worker suscribe a eventos del ledger y mantiene una tabla `flujo_caja_semana` actualizada. El endpoint solo lee esa tabla. |
| C — Cache con TTL | Se calcula la primera vez y se cachea N minutos. |

### Decisión

**Opción A.** El flujo de caja proyectado es una *lectura derivada* sin efectos secundarios. Los datos que alimenta (CxC, OC, programaciones) cambian con poca frecuencia (< 100 registros por proyecto activo). Una consulta directa es correcta, rápida y no introduce estado que pueda descuadrar.

La opción B tiene sentido solo si el volumen de registros activos superara miles y el tiempo de respuesta se volviera inaceptable. Con el modelo de datos actual, ese punto no se alcanzará antes de la Capa 4.

**Consecuencias:**
- No hay tabla ni worker nuevo para la proyección.
- El endpoint puede tardar ~200–400 ms para proyectos con cientos de OCs y CxCs — aceptable para un CFO que consulta desde el escritorio.
- Si se agrega cache (Redis/local) en el futuro, se puede hacer sin cambiar la interfaz.

---

## Decisión 2 — `cubicacion_proyectada` como tabla de entrada explícita

### Problema

La proyección necesita "cobros futuros planificados" que aún no existen como cubicaciones reales. Se evaluaron dos opciones:

| Opción | Descripción |
|--------|-------------|
| **A — Tabla explícita (elegida)** | `cubicacion_proyectada` es un instrumento de planificación: el dueño registra cuándo espera certificar y cuánto. Es un "intención de factura". |
| B — Derivar del cronograma | Si el cronograma incluye avance planeado por semana, la proyección se deriva de él. Requiere Capa 4 (cronograma avanzado) y hoy no existe. |

### Decisión

**Opción A.** La tabla `cubicacion_proyectada` no pasa por el ledger (es planeación, no ejecución), igual que `partida`, `linea_presupuesto` y `apu`. Cuando la cubicación real se emite, se vincula vía `cubicacion_id` y el ítem proyectado queda excluido automáticamente del flujo.

---

## Decisión 3 — Fuentes de outflows: OC EMITIDA vs CxP

### Problema

Los pagos comprometidos provienen de dos estados distintos del ciclo de compras:
1. OCs firmadas y enviadas al proveedor pero aún no recibidas → `orden_compra.estado = 'EMITIDA'`
2. Facturas recibidas y aprobadas, aún no pagadas → `cuenta_por_pagar.estado IN ('PENDIENTE','PAGADA_PARCIAL')`

No se puede sumar ambas sin double-counting: cuando una OC se recibe y se factura, la CxP reemplaza al outflow de la OC.

### Decisión

- **Por proyecto (`calcularFlujoPorProyecto`):** usar OC EMITIDA (via linea→partida→proyecto) + programaciones de pago del proyecto. No se incluyen CxP directamente (la CxP no tiene `proyecto_id`, el join completo sería demasiado costoso para el MVP).
- **Consolidado (`calcularFlujoConsolidado`):** usar CxP pendientes de la empresa + programaciones de pago. No se incluyen OC EMITIDAS (ya estarían representadas por las CxP si se recibieron; si no se recibieron, son outflows aún no formalizados que el usuario verá en el nivel de proyecto).

Esta asimetría es conocida y está documentada. La consistencia perfecta requeriría un campo `proyecto_id` en `cuenta_por_pagar`, que se añadirá en una futura sesión.

---

## Decisión 4 — Semana como unidad de tiempo

Se eligió la semana (7 días) como unidad porque:
1. El estándar de la industria de construcción para flujo de caja es "cash flow semanal" o "cash flow de 13 semanas" (un trimestre).
2. Suficientemente granular para detectar semanas de quiebre de caja.
3. No tan granular como para generar ruido: los pagos en construcción rara vez son al día exacto.

Los ítems con fecha anterior al horizonte se asignan a la semana 1 (vencidos/urgentes), no se descartan. Los ítems más allá del horizonte se excluyen.

---

## Consecuencias

1. `FlujoCajaService` es síncrono, sin handlers de proyección ni outbox.
2. `cubicacion_proyectada` tiene su propio CRUD (`/api/v1/proyectos/:id/cubicaciones-proyectadas`).
3. La vinculación `cubicacion_proyectada.cubicacion_id` elimina el doble conteo cuando la cubicación real se emite. El cliente debe vincular explícitamente (o lo hace `CubicacionService` al emitir).
4. El campo `proyecto_id` en `cuenta_por_pagar` es deuda técnica identificada. Se añadirá cuando el módulo de subcontratos (Capa 3) genere CxPs con imputación de proyecto.
