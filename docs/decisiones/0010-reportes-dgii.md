# ADR-0010 — Reportes DGII: arquitectura on-the-fly, fuentes de datos y reconciliación contable

**Estado:** Aceptado  
**Fecha:** 2026-06-16  
**Sesión:** Sesión 7 Capa 2

---

## Contexto

La Sesión 7 Capa 2 implementó los reportes fiscales obligatorios de la DGII: **606** (compras), **607** (ventas), **608** (anulados), **623** (retenciones del Estado) e **IT-1** (declaración mensual de ITBIS). El principio rector es §17 de la arquitectura: *"generados desde los mismos eventos, sin re-digitación"*.

---

## Decisión 1 — Arquitectura: on-the-fly vs materializado

| Opción | Descripción |
|--------|-------------|
| **A — On-the-fly (elegida)** | `ReporteDgiiService` consulta en tiempo real `factura_proveedor`, `comprobante_ecf`, `factura_cliente` y `linea_asiento`. |
| B — Tabla resumen mensual | Un worker escucha el ledger y mantiene `reporte_fiscal_606`, etc. |

**Decisión: Opción A.** Los reportes fiscales se generan bajo demanda. El volumen por período mensual es pequeño (decenas/cientos de documentos), y el tiempo de respuesta es aceptable (< 500 ms). Una tabla materializada añade complejidad sin beneficio medible en este escenario.

**Consecuencias:**
- No hay tablas nuevas de reportería.
- El endpoint puede responder directamente en JSON o como descarga TXT.

---

## Decisión 2 — Separación: lógica pura vs acceso a BD

La lógica de generación (totales, fórmulas IT-1, reconciliación) vive en **`packages/localizacion-do`** (pura, sin I/O, probada en unidad). El acceso a BD vive en **`apps/api/src/localizacion-do/ReporteDgiiService`**.

Esto implementa la regla de CLAUDE.md: *"toda lógica fiscal dominicana vive solo en `localizacion-do`"*. El paquete ya tenía `ecf-builder.ts`, `ecf-validator.ts`, etc. con el mismo patrón.

---

## Decisión 3 — Fuentes por reporte

| Reporte | Fuente principal | Filtros |
|---------|-----------------|---------|
| 606 | `factura_proveedor` + `tercero` | deleted_at IS NULL, fechaFactura ∈ período |
| 607 | `comprobante_ecf` + `factura_cliente` + `tercero` | estado='ACEPTADO', fechaEmision ∈ período |
| 608 | `comprobante_ecf` | estado='RECHAZADO', fechaEmision ∈ período |
| 623 | `factura_cliente` + `tercero` + `comprobante_ecf` | tercero.es_institucion_estatal=true, retenciones > 0 |
| IT-1 | agrega 606 (adelantado) + 607 (cobrado) + 623 (retenido) + `linea_asiento` | cuentas 1106 y 2102, estado='confirmado' |

---

## Decisión 4 — Retenciones en 606: calculadas, no almacenadas

`factura_proveedor` no tiene columnas de retención ISR/ITBIS. Las retenciones se **calculan en tiempo de reporte** desde `tercero.retencionIsrPct` y `tercero.retencionItbisPct`.

**Justificación:** La retención se practica en el momento del pago, no en la recepción de la factura. El 606 declara lo retenido en el período. Dado que la construcción dominicana típica paga a 30-60 días, añadir columnas de retención en `factura_proveedor` sin el ciclo de pago completo sería incompleto.

**Deuda técnica identificada:** Cuando se implemente el pago real de CxP (Capa 3), se añadirán `monto_retencion_isr` y `monto_retencion_itbis` a `factura_proveedor`, y el 606 los usará en lugar de los calculados. Esta transición es no disruptiva (solo cambia la fuente del campo, no la interfaz del reporte).

---

## Decisión 5 — ITBIS adelantado en IT-1: solo E31/B01 validados

Solo las facturas de proveedor con `tipoEcf IN ('E31','B01')` y `ecf_validado=true` generan crédito fiscal ITBIS. Las compras de bienes (E41) y facturas no validadas no sustentan crédito ante la DGII.

---

## Decisión 6 — Reconciliación IT-1 con tolerancia de 1 centavo

La función `generarReporteIT1` marca `cuadra=true` si la diferencia entre el ITBIS fiscal y el ITBIS contable es ≤ 0.01. Esto absorbe redondeos de conversión `NUMERIC(18,4) → 2 decimales` en los exportadores TXT.

---

## Consecuencias

1. Lógica pura en `packages/localizacion-do`: 7 archivos nuevos (types + 5 generadores + exportadores).
2. `ReporteDgiiService` y `ReporteDgiiController` en `apps/api/src/localizacion-do/`.
3. Nuevo permiso `REPORTE_DGII_READ` en `packages/core`.
4. Formato de exportación TXT pipe-delimited para 606/607/608/623 (IT-1 solo JSON).
5. No hay migración — no se añaden tablas.
6. La deuda técnica de retenciones en `factura_proveedor` se resuelve en Capa 3.
