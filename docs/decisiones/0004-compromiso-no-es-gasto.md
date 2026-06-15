# ADR-0004: El compromiso no es un gasto — emision_oc sin asiento contable

**Fecha:** 2026-06-14  
**Estado:** Aprobado  
**Autores:** Equipo Tributia BuildCore  
**Contexto:** Sesión 5 Capa 1 — Compras I (Requisición → Cotización → Orden de Compra)

---

## Contexto

Cuando se emite una Orden de Compra (OC) aprobada, el sistema necesita registrar que
una parte del presupuesto de una partida ha sido "comprometida": hay un compromiso
contractual de pago, pero el gasto aún no se ha devengado porque el material no ha sido
recibido ni el servicio prestado.

La pregunta de diseño es: **¿debe el evento `emision_oc` generar un asiento contable?**

## Decisión

**No.** El evento `emision_oc` **no genera asiento contable**.

El único efecto del evento `emision_oc` es actualizar la proyección `ejecucion_partida.comprometido`
para reflejar el monto comprometido contra el presupuesto de cada partida.

El asiento contable surge más adelante en el ciclo:

| Hecho operativo       | Evento                      | Asiento contable                          |
|-----------------------|-----------------------------|-------------------------------------------|
| OC emitida            | `emision_oc`                | **Ninguno** — es un compromiso, no un gasto |
| Material recibido     | `recepcion_material`        | DB Inventario / CR Cuentas por Pagar      |
| Factura del proveedor | `recepcion_factura_proveedor` | Confirma y ajusta CP si hay discrepancia |
| Pago realizado        | `pago_emitido`              | DB Cuentas por Pagar / CR Banco           |

## Justificación

### 1. Principio de devengo (matching principle, NIC 1 / NIIF)

El principio contable de devengo establece que los gastos se reconocen cuando se incurren,
no cuando se comprometen. Una OC emitida es una intención contractual de compra; el gasto
se devenga cuando el bien es recibido y aceptado (o el servicio prestado).

Registrar un asiento en la fecha de la OC:
- Inflaría artificialmente las cuentas por pagar (pasivo) sin que exista una obligación
  exigible en ese momento (el proveedor aún no ha cumplido su parte).
- Violaría el principio de realización para el reconocimiento del activo (el inventario
  no está en el almacén todavía).

### 2. Distinción entre commitment accounting y financial accounting

El "comprometido" es una herramienta de **gestión presupuestal** (control de obra),
no un registro contable. Es la respuesta a la pregunta del gerente de proyecto:
"¿Cuánto del presupuesto de esta partida ya tiene destino definido?"

El libro mayor contable responde a preguntas diferentes: ¿cuánto se debe?, ¿cuánto hay
en inventario?, ¿cuánto fue el costo del período?

Mezclar los dos niveles es el error más común en sistemas de construcción que terminan
mostrando pasivos que no existen y activos que no están en el almacén.

### 3. Práctica de la industria de la construcción

Los sistemas de construcción reconocidos (Procore, Sage 300 CRE, Viewpoint, CMiC) separan
explícitamente el "committed cost" (comprometido) del "actual cost" (devengado/incurrido):
- **Committed** = OCs + Subcontratos firmados (control gerencial, no contable)
- **Incurred** = Recepciones aceptadas + horas ejecutadas (contabilidad)

### 4. Consecuencias para el sistema

**Handler `ComprasEmisionOcHandler`:**
- Tipo: `sincrono` (misma transacción que el evento)
- Acción: UPSERT `ejecucion_partida`, sumando el monto de cada línea de OC al
  `comprometido` de la partida correspondiente.
- Asiento contable generado: **ninguno**.

**Excepción explícita requerida:**
Para que el motor de reglas contables no lance error al no encontrar regla para `emision_oc`,
el handler debe declararse como exento. El tipo `emision_oc` se registra en el catálogo
cerrado de eventos SIN regla contable asociada — esto es intencional y no un olvido.

## Consecuencias

### Positivas
- El libro mayor queda limpio: solo refleja hechos económicos consumados.
- La tríada presupuestado/comprometido/devengado queda claramente separada en capas:
  - `linea_presupuesto.total` → lo planeado
  - `ejecucion_partida.comprometido` → lo comprometido (gestión)
  - `asiento_contable` (via reglas) → lo contabilizado (contabilidad)
- Facilita la conciliación: la diferencia entre comprometido y devengado es la OC
  pendiente de recibir — información valiosa para la proyección de flujo de caja.

### Negativas / Riesgos mitigados
- Un usuario podría esperar ver la OC en el libro mayor; esto debe comunicarse en la
  interfaz y en la capacitación: "La OC reserva presupuesto pero no genera contabilidad."
- Si una OC es cancelada DESPUÉS de ser emitida, se requiere un evento de reversa
  (`cancelacion_oc`) que decremente el comprometido. Este evento se implementa en
  Compras II junto con el flujo completo de cancelaciones.

## Alternativas descartadas

**A. Asiento de "compromiso" (commitment accounting) en la OC:**
Algunos sistemas ERP registran un cargo al presupuesto del proyecto y un abono a una
cuenta de "compromisos" cuando se emite la OC. Esto introduce una cuenta de orden que
complica los estados financieros y no es requerido por NIIF ni por el código tributario
dominicano.

**B. Asiento DB Inventario en tránsito / CR Cuentas por Pagar en la OC:**
Viola el principio de devengo. El inventario no existe hasta que entra al almacén.

## Referencias

- NIIF (NIC 1, NIC 2, NIC 37) — reconocimiento de gastos y pasivos contingentes
- FASB ASC 420 — Exit and Disposal Cost Obligations
- NCRS (Dominican Republic) — Código de Comercio, principio de devengo
- Sage 300 CRE "Committed Cost Report" vs "Job Cost Ledger" distinction
