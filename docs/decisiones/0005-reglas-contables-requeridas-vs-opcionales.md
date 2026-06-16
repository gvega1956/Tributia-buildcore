# ADR-0005 — Reglas contables requeridas vs. opcionales

**Estado:** Aceptado  
**Fecha:** 2026-06-15  
**Autores:** Equipo Tributia BuildCore

---

## Contexto

El motor de reglas contables (ADR-0003, Sesión 7 Capa 1) permite que cada empresa configure las cuentas contables a usar para cada tipo de evento. Hasta la sesión Pre-vuelo Capa 2, los tres handlers `hora_personal`, `hora_equipo` y `recepcion_factura_proveedor` aplicaban una política de "graceful-skip": si la empresa no tenía la regla configurada, el handler actualizaba igualmente el devengado/CxP y emitía un `logger.warn`, pero no generaba el asiento.

Esto viola el principio 2 de la arquitectura ("Event Ledger es la columna vertebral"):

> "Las proyecciones derivan de ahí. **Nada actualiza una proyección directamente.**"

y el principio 4:

> "Contabilidad por reglas. **Asientos manuales solo para ajustes, siempre auditados.**"

Si el costo de `hora_personal` entra en `ejecucion_partida.devengado` sin su correspondiente asiento de partida doble, la tríada (comprometido + devengado + disponible = presupuesto vigente) está en la BD mientras el libro mayor no refleja el mismo importe. Este descuadre opera-vs-contabilidad es exactamente el problema central que toda la arquitectura existe para impedir.

---

## Decisión

### Reglas REQUERIDAS

Los siguientes tipos de evento generan un costo o pasivo real que DEBE quedar registrado en el libro mayor en la misma transacción:

| Tipo de evento | Asiento esperado |
|---|---|
| `hora_personal` | DEBE 6201 Costo MO en Obra / HABER 2110 MO por Pagar |
| `hora_equipo` | DEBE 6202 Costo Equipos Obra / HABER 1503 Depreciación/Equipos |
| `recepcion_factura_proveedor` | DEBE 5101 Costo de obra / HABER 2101 CxP Proveedores |

**Si la empresa no tiene la regla configurada, el evento FALLA** con una excepción explícita. El handler no puede completarse en silencio. El operador debe configurar la regla contable antes de poder registrar el hecho operativo.

El conjunto de tipos requeridos está documentado en código en `packages/contabilidad/src/tipos-evento-requerido.ts` y exportado como `TIPOS_EVENTO_CONTABLE_REQUERIDO`.

### Reglas OPCIONALES (exentas por diseño)

Los siguientes tipos de evento NO generan un asiento porque el movimiento financiero ocurre en un evento posterior:

| Tipo de evento | Razón de exención |
|---|---|
| `emision_oc` | Solo mueve `comprometido`; el gasto se reconoce en `recepcion_factura_proveedor` |
| `avance_partida` | Hecho físico (cantidad ejecutada), no financiero; EV es informacional |
| `transferencia_almacen` | Movimiento interno de inventario; no cambia el costo total de la empresa |
| `orden_cambio_aprobada` | Ajusta presupuesto vigente; el asiento se genera cuando se factura |

---

## Alternativas consideradas

### Alternativa A: Bandeja de "pendiente de contabilizar"
Crear una tabla `pendiente_contabilizar` donde el evento queda registrado esperando que el operador configure la regla. Permite procesar el evento aunque falte la regla.

**Rechazada** porque: (a) permite que el libro mayor quede desincronizado con la tríada; (b) añade complejidad operativa (¿quién monitorea la bandeja? ¿cuándo se aplica?); (c) incentiva el descuido en la configuración inicial.

### Alternativa B: Columna `requerida: boolean` en `regla_contable`
Agregar una columna a la tabla de reglas para que la empresa marque cuáles son requeridas.

**Rechazada** porque: la naturaleza requerida/opcional es arquitectónica, no de configuración de la empresa. Todas las empresas en todos los países deben reconocer el gasto de hora_personal en el mismo momento. La flexibilidad está en qué cuentas usar (eso sí es configurable), no en si se genera el asiento.

### Alternativa C (adoptada): Falla explícita con error descriptivo
Si falta la regla, el handler lanza `Error` con mensaje que indica exactamente qué configurar. La transacción se revierte. El hecho operativo no queda registrado hasta que la configuración esté completa.

---

## Consecuencias

**Positivas:**
- El libro mayor siempre refleja todos los costos en el mismo momento en que aparecen en la tríada.
- El descuadre opera-vs-contabilidad es imposible por construcción.
- El error es visible e inmediato, no silencioso.

**Negativas:**
- Al implementar una nueva empresa, el administrador DEBE configurar las reglas contables para estos tres tipos de evento antes de poder registrar partes diarios o recibir facturas de proveedores.
- Esto es un requisito de onboarding documentado, no un defecto.

---

## Implementación

Commit en rama `feat/tenancy-rls`. Archivos modificados:

- `packages/contabilidad/src/tipos-evento-requerido.ts` — nueva constante
- `packages/contabilidad/src/index.ts` — exporta la constante
- `apps/api/src/obra/handlers/obra-hora-personal.handler.ts` — throw en lugar de warn
- `apps/api/src/obra/handlers/obra-hora-equipo.handler.ts` — throw en lugar de warn
- `apps/api/src/compras/handlers/compras-recepcion-factura-proveedor.handler.ts` — throw en lugar de warn
- `apps/api/src/obra/__tests__/obra.integration.spec.ts` — handlers 05/07 usan servicios reales
- `apps/api/src/compras/__tests__/compras2.integration.spec.ts` — tests 12/13 verifican asiento exacto
