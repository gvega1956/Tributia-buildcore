# ADR-0008 — Tesorería: conciliación por clave compuesta y handler atómico de banco

**Estado:** Aceptado  
**Fecha:** 2026-06-16  
**Sesión:** Sesión 5 Capa 2

---

## Contexto

La sesión 5 Capa 2 implementó el módulo de Tesorería (bancos, conciliación bancaria, caja chica, cobros y pagos programados). Dos decisiones de diseño no son obvias y se documentan aquí para evitar regresiones futuras.

---

## Decisión 1 — Conciliación automática por clave compuesta `fecha::monto::tipo`

### Alternativas consideradas

| Opción | Descripción |
|--------|-------------|
| **A — Clave compuesta (elegida)** | `${fecha}::${montoAbs.toFixed(4)}::${tipo}` — busca un movimiento sin conciliar con la misma fecha, mismo monto absoluto y mismo tipo (DEPOSITO/RETIRO). |
| B — Sólo por monto | Ignora la fecha y el tipo. Alta tasa de falsos positivos en extractos con múltiples depósitos del mismo importe. |
| C — Fuzzy por ventana de días | Permite ±N días de diferencia. Más flexible pero introduce ambigüedad; dificulta la idempotencia. |

### Decisión

Opción A. La clave compuesta (`fecha + montoAbs + tipo`) es lo suficientemente específica para la mayoría de los extractos bancarios dominicanos (Banco Popular, BHD, BanReservas), donde la fecha del extracto coincide con la fecha de valor del movimiento.

**Limitación conocida:** si hay dos cobros del mismo importe el mismo día, el algoritmo elige el primero que aparece y marca el otro como DIFERENCIA para resolución manual. Este comportamiento es intencionado — es preferible exigir resolución manual en casos ambiguos a conciliar incorrectamente.

### Consecuencias

- Las diferencias irresolubles se marcan como `DIFERENCIA` y el operador las resuelve vía `conciliarManual` o `ignorarLinea`.
- Si el banco reporta fecha de extracto diferente a la fecha de valor, la tasa de auto-conciliación baja y se eleva la carga de conciliación manual. Se aceptó como trade-off.

---

## Decisión 2 — `BancoMovimientoHandler`: handler síncrono separado para actualizar saldo

### Problema

Cuando se registra un `cobro_recibido`, tres consecuencias deben ocurrir **en la misma transacción** de base de datos:
1. Insertar el `evento_operativo` (append-only).
2. Generar el asiento contable (DEBE Banco / HABER CxC) — `ContabilidadCobroRecibidoHandler`.
3. Crear el `movimiento_bancario` y actualizar `cuenta_bancaria.saldo_actual`.

### Alternativas

| Opción | Descripción |
|--------|-------------|
| **A — Handler separado (elegido)** | `BancoMovimientoHandler` escucha `cobro_recibido`, `pago_emitido` y `reposicion_caja_chica` y actualiza banco en la misma tx síncrona. |
| B — Inline en el servicio | El servicio de cobro actualiza el saldo después de `LedgerService.append`. Las proyecciones son responsabilidad del motor, no del servicio. Viola la separación de responsabilidades. |
| C — Outbox asíncrono | Saldo actualizado por un worker fuera de la tx. El saldo queda temporalmente desactualizado; las validaciones de disponibilidad (pago con caja) pueden leer valores stale. |

### Decisión

Opción A. El saldo de la cuenta bancaria es un dato operativo crítico (se usa en `ejecutarLote` para decidir si hay fondos). Mantenerlo actualizado en la misma transacción que el evento garantiza consistencia sin cache de saldo. El handler es síncrono y corre dentro de `ProjectionEngineService` antes de que la transacción haga commit.

### Consecuencias

- El `BancoMovimientoHandler` debe registrarse en `LedgerModule.PROJECTION_HANDLER_TOKEN` con los tres tipos de evento.
- Si se añade un cuarto tipo de evento que toca el saldo bancario, se extiende el switch de este handler.

---

## Decisión 3 — Reposición de caja chica: re-lectura del estado del workflow

### Problema

El `ReposicionCajaChicaService.ejecutar` recibe el ID de la reposición pero no el estado de la instancia de flujo. El estado actual podría ser distinto al que el cliente vio.

### Decisión

El servicio **siempre** re-lee `instancia_flujo.estado` via `WorkflowService.findInstanciaById` dentro de la misma llamada, rechaza si no es `APROBADO`. No se acepta el estado desde el payload del cliente ni desde la caché.

Esto evita la race condition TOCTOU: aprobar → estado cached APROBADO → revocar → ejecutar igualmente porque el caller no refrescó.
