# Auditoría de Capa 2 — Evidencias y Hallazgos
**Fecha:** 2026-06-17  
**Sesión:** Sesión 8 Capa 2  
**Auditor:** Sesión automatizada (Claude Code)  
**Base:** metodología de capa-0.md y capa-1.md

---

## Resumen ejecutivo

La Capa 2 cubre: libros contables/estados financieros, cierre contable mensual + multimoneda, CxC y cubicaciones, emisión de e-CF (31/32/33/34), tesorería (bancos, conciliación, caja chica, cobros, pagos programados), flujo de caja proyectado, y reportes DGII (606/607/608/623/IT-1).

Se encontraron y corrigieron **4 defectos** antes del cierre. Después de las correcciones, la tríada es **331/331 verde, lint limpio, typecheck limpio**.

---

## 1. Inventario de tablas nuevas en Capa 2

| Tabla | tenant_id | Audit cols | RLS | GRANT tributia_app |
|-------|-----------|-----------|-----|---------------------|
| `cuenta_por_cobrar` | ✓ | ✓ | ✓ | ✓ |
| `cubicacion` | ✓ | ✓ | ✓ | ✓ |
| `cubicacion_linea` | ✓ | ✓ | ✓ | ✓ |
| `factura_cliente` | ✓ | ✓ | ✓ | ✓ |
| `comprobante_ecf` | ✓ | ✓ | ✓ | ✓ |
| `acuse_ecf` | ✓ | ✓ | ✓ | ✓ |
| `cuenta_bancaria` | ✓ | ✓ | ✓ | ✓ |
| `movimiento_bancario` | ✓ | ✓ | ✓ | ✓ |
| `fondo_caja_chica` | ✓ | ✓ | ✓ | ✓ |
| `gasto_caja_chica` | ✓ | ✓ | ✓ | ✓ |
| `reposicion_caja_chica` | ✓ | ✓ | ✓ | ✓ |
| `programacion_pago` | ✓ | ✓ | ✓ | ✓ |
| `periodo_contable` | ✓ | ✓ | ✓ | ✓ |
| `tasa_cambio` | ✓ | ✓ | ✓ | ✓ |
| `cubicacion_proyectada` | ✓ | ✓ | ✓ | ✓ (ver Defecto A) |

---

## 2. Cobertura de tipos de evento nuevos en Capa 2

| Tipo de evento | Schema Zod | Handler proyección | Regla contable | Tipo (ADR-0005) | Test asiento exacto |
|----------------|-----------|-------------------|----------------|-----------------|---------------------|
| `emision_factura_cliente` | ✓ | `CxcEmisionFacturaClienteHandler` | REQUERIDA | REQUERIDO | ✓ (cxc.integration.spec.ts test 06+07; e2e test 01) |
| `cobro_recibido` | ✓ | `ContabilidadCobroRecibidoHandler` | REQUERIDA | REQUERIDO | ✓ (tesorería test 02; e2e test 03) |
| `gasto_caja_chica` | ✓ | `ContabilidadGastoCajaChicaHandler` | REQUERIDA | REQUERIDO | ✓ (capa2-handlers test 01) **← Defecto C corregido** |
| `reposicion_caja_chica` | ✓ | `ContabilidadReposicionCajaChicaHandler` | REQUERIDA | REQUERIDO | ✓ (capa2-handlers test 02) **← Defecto C corregido** |
| `pago_emitido` | ✓ | `ContabilidadPagoEmitidoHandler` | OPCIONAL (graceful-skip) | OPCIONAL | ✓ (capa2-handlers test 03) **← Defecto C corregido** |

---

## 3. Defectos encontrados y corregidos

### Defecto A — GRANT faltante en `cubicacion_proyectada` (migración 0028)
**Severidad:** Media — Bloquea rol `tributia_app` en producción  
**Descripción:** La migración `0028_flujo_caja.sql` creó la tabla `cubicacion_proyectada` pero omitió el `GRANT SELECT, INSERT, UPDATE, DELETE ON cubicacion_proyectada TO tributia_app`. Los tests no lo detectaron porque todos usan el rol admin (que bypasea RLS y permisos).  
**Corrección:** Migración `0029_capa2_audit.sql` con el GRANT faltante.  
**Evidencia:** `apps/api/src/db/migrations/0029_capa2_audit.sql`

---

### Defecto B — `ncfModificado` siempre `undefined` en 607 para E33/E34
**Severidad:** Alta — La DGII rechaza reportes 607 sin NCF del comprobante origen  
**Descripción:** En `reporte-dgii.service.ts`, la función `generar607()` tenía dead code para calcular `ncfModificado` de ajustes (E33/E34): ambas ramas del ternario devolvían `undefined`. El NCF del comprobante origen nunca se incluía en las filas del 607.  
**Corrección:** Drizzle alias self-join (`alias(comprobantesEcf, 'origen_ecf')`) para obtener `ncfOrigen` en la misma consulta.  
**Evidencia:** `apps/api/src/localizacion-do/reporte-dgii.service.ts` función `generar607()`

---

### Defecto C — Sin tests de asientos exactos para handlers de tesorería (DoD)
**Severidad:** Alta — Incumple Definition of Done (regla contable sin test de asiento exacto)  
**Descripción:** `gasto_caja_chica`, `reposicion_caja_chica` y `pago_emitido` tenían handlers contables registrados como REQUERIDO/OPCIONAL pero ningún test verificaba los importes exactos en `linea_asiento`. Los tests existentes solo verificaban "no error" (falso verde aprendido en Capa 1).  
**Corrección:** Nuevo archivo `apps/api/src/contabilidad/__tests__/capa2-handlers.integration.spec.ts` con 4 tests:  
- Test 01: `gasto_caja_chica` → DEBE 5101.01 = 3500.0000 / HABER 1103.01 = 3500.0000, Σdebe = Σhaber  
- Test 02: `reposicion_caja_chica` → DEBE 1103.01 = 5000.0000 / HABER 1101.01 = 5000.0000, Σdebe = Σhaber  
- Test 03: `pago_emitido` con regla → DEBE 2101.01 = 25000.0000 / HABER 1101.01 = 25000.0000, Σdebe = Σhaber  
- Test 04: `gasto_caja_chica` sin regla → throw explícito `Regla contable requerida para 'gasto_caja_chica'` (no silencio)  
**Evidencia:** `apps/api/src/contabilidad/__tests__/capa2-handlers.integration.spec.ts`

---

### Defecto D — Sin test e2e del flujo de ingresos completo (DoD)
**Severidad:** Media — Falta evidencia de integración entre CxC, e-CF, tesorería y DGII  
**Descripción:** Cada módulo (CxC, e-CF, tesorería, DGII) tenía sus propios tests de integración pero no existía un test que verificara la cadena completa: avance → cubicación → factura → comprobante e-CF → cobro → CxC=0 → reflejo en 607 e IT-1.  
**Corrección:** Nuevo archivo `apps/api/src/cxc/__tests__/flujo-ingresos-e2e.integration.spec.ts` con 5 tests:  
- Test 01: Cubicación 50 m³ × 2000 DOP → factura cliente → CxC PENDIENTE 118,000 DOP + asiento 3 líneas balanceado (DEBE 1102 = 118K / HABER 4101 = 100K / HABER 2102 = 18K)  
- Test 02: Comprobante e-CF E31 ACEPTADO (NCF `B0100000099`) vinculado a la factura  
- Test 03: `cobro_recibido` 118,000 DOP → CxC estado = `PAGADA_TOTAL`, asiento DEBE 1101 / HABER 1102  
- Test 04: 607 incluye el comprobante E31 con NCF correcto, subtotal = 100,000, RNC cliente = `130111555`  
- Test 05: IT-1 cuadra después de confirmar asientos (simulando cierre contable) — `itbisCobrado` = `itbisPorPagarContable` = 18,000 DOP, `cuadra = true`  
**Evidencia:** `apps/api/src/cxc/__tests__/flujo-ingresos-e2e.integration.spec.ts`

---

## 4. Verificaciones adicionales por tema

### 4.1 Período cerrado — blindo a nivel de motor
- **Verificado en:** `apps/api/src/contabilidad/asiento-contable.service.ts`
- `generar()` ejecuta `SELECT estado FROM periodos_contables WHERE ... AND fecha BETWEEN inicio AND fin`.
- Si `periodo.estado = 'CERRADO'` → lanza `ConflictException('Período contable CERRADO')`.
- Si no existe período: el motor **no bloquea** — decisión documentada en `docs/decisiones/0005-motor-reglas-contables.md` (blindo a nivel aplicación, no DB trigger).
- **Cobertura:** `contabilidad/__tests__/cierre-multimoneda.integration.spec.ts` test 10 (verifica que asiento post-cierre es rechazado).

### 4.2 e-CF preservado con acuse
- **Verificado en:** `apps/api/src/db/schema/localizacion-do/comprobante_ecf.ts`
- Tabla `comprobante_ecf` tiene `estado`, `en_contingencia`, `ri_numero`, `ri_codigo_seguridad`.
- Tabla `acuse_ecf` vinculada por `comprobante_ecf_id`.
- Soft-delete via `deleted_at`.
- **Cobertura:** `localizacion-do/__tests__/emision-ecf.integration.spec.ts` 5 tests.

### 4.3 606 y 607 reconcilian con el libro mayor
- **Verificado en:** `generar606()` / `generar607()` en `reporte-dgii.service.ts`
- 606: consulta `factura_proveedor + tercero`, filtra por `deleted_at IS NULL` y período.
- 607: consulta `comprobante_ecf (estado='ACEPTADO') + factura_cliente + tercero`, filtra por período.
- `generarIT1()` reconcilia `itbisCobrado` (607) con `net_CR` de cuenta `2102%` en `linea_asiento` (asientos confirmados).
- **Cobertura:** `reporte-dgii.integration.spec.ts` tests 06-10; e2e test 05.

### 4.4 Diferencia cambiaria — cálculo correcto
- **Verificado en:** `apps/api/src/contabilidad/handlers/contabilidad-diferencia-cambiaria.handler.ts`
- Escucha eventos `cobro_recibido`, calcula diferencia entre `tasaFactura` y `tasaCobro`.
- Si `|diferencia| > 0` → genera asiento DEBE/HABER en cuenta de diferencia cambiaria.
- Prueba exacta: `cierre-multimoneda.integration.spec.ts` tests 14+15 (diferencia positiva y negativa con montos exactos).

---

## 5. Resultado final de la tríada

| Verificación | Resultado |
|-------------|-----------|
| Tests de integración | **331/331 verde** |
| TypeScript typecheck | **limpio** (0 errores) |
| ESLint | **limpio** (0 errores) |

---

## 6. Conclusión

**CAPA 2 TERMINADA Y AUDITADA.** Los 4 defectos encontrados durante la auditoría fueron corregidos en la misma sesión. La tríada verde confirma que cada hecho de ingreso en Tributia BuildCore tiene: evento en el ledger, asiento contable balanceado, CxC que llega a cero al cobrar, y reflejo correcto en los reportes fiscales 607 e IT-1 de la DGII.
