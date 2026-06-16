# ADR-0007 — Emisión de e-CF: frontera del middleware, responsabilidad por empresa, contingencia y retención

**Estado:** Aceptado
**Fecha:** 2026-06-16
**Autores:** Equipo Tributia BuildCore

---

## Contexto

Hasta esta sesión, `packages/localizacion-do` solo validaba e-CF **recibidos** de proveedores (Capa 1, Sesión 6). La Sesión 4 de Capa 2 pide la **emisión** de e-CF de venta (31 crédito fiscal, 32 consumo, 33 nota de débito, 34 nota de crédito) sobre "el middleware e-CF ya existente" — un servicio externo, probado, versionado de forma independiente (§17 y tabla de decisiones de `docs/arquitectura.md`: *"e-CF: Middleware existente como servicio interno independiente con su propio ciclo de versiones — la DGII cambia formatos; el middleware se actualiza sin tocar Tributia BuildCore"*).

El modelo de responsabilidad ya fue decidido fuera de este ADR (instrucción explícita de la sesión): **cada empresa es su propio emisor electrónico** ante la DGII, con su propio certificado digital y su propia autorización — Tributia BuildCore nunca es Proveedor de Servicios de Facturación Electrónica (PSFE), solo la herramienta. Esto exige rastrear configuración de emisión **por empresa**, no por tenant.

No existe en el repo ningún cliente del middleware, ninguna tabla de configuración de emisor, ningún modelo de e-CF emitido/acuse, y `CatalogoDgiiService.tiposEcfVigentes()` solo filtra por `activo`, no por vigencia de fecha (`valido_desde`/`valido_hasta`), pese a que el catálogo está diseñado para versionarse en el tiempo.

Restricciones duras de `docs/arquitectura.md` §22 que aplican directamente:
- *"certificados digitales de clientes en bóveda de secretos (HSM/KMS), jamás en la BD de aplicación."*
- *"Retención documental fiscal: e-CF y acuses conservados los plazos que exige la norma, con verificación de integridad."*

Y de CLAUDE.md: toda lógica fiscal vive exclusivamente en `packages/localizacion-do`.

---

## Decisión

### 1. Frontera del middleware: puerto puro en `localizacion-do`, adaptador de I/O en `apps/api`

`packages/localizacion-do` define el **contrato** (`IMiddlewareEcfClient`, tipos de entrada/salida) y toda la **lógica fiscal pura** (construcción de la estructura del comprobante, reglas de contingencia/RI, cálculo de hash de integridad, plazo de retención documental). No contiene HTTP, DB ni ningún I/O — sigue exactamente el patrón ya establecido por `validarEcf()`.

`apps/api/src/localizacion-do/` (nuevo módulo) contiene el **adaptador**: la implementación inyectable de `IMiddlewareEcfClient` que en este repo es `FakeMiddlewareEcfAdapter` (no hay middleware real alcanzable en este entorno; el adaptador es deliberadamente reemplazable — el día que exista el cliente HTTP real del middleware, se escribe una nueva clase que implementa el mismo puerto, sin tocar `localizacion-do` ni el servicio orquestador). Este es el mismo patrón que `StorageService` (S3/MinIO) y `SmtpAdapter` (Sesión 10): puerto + adaptador inyectado por token DI, con modo "log-only"/determinista para desarrollo y pruebas.

`apps/api/src/localizacion-do/emision-ecf.service.ts` es el único lugar que: lee configuración del emisor, asigna el siguiente número de secuencia, llama al puerto del middleware, persiste `comprobante_ecf`/`acuse_ecf`, actualiza `factura_cliente.ncf` y registra el evento en el ledger. Nunca contiene reglas fiscales — esas viven en `localizacion-do` y el servicio solo las invoca.

### 2. Configuración del emisor: por empresa, certificado solo por referencia

Nueva tabla `configuracion_emisor_ecf` (única por `empresa_id`): `ambiente` (TEST/CERTIFICACION/PRODUCCION), `rnc_emisor`, `razon_social_emisor`, `certificado_referencia` (string opaco — puntero a la bóveda HSM/KMS externa, **nunca** el certificado en sí), `activo`. La aplicación nunca almacena ni transmite material de certificado; solo el puntero.

Nueva tabla `secuencia_ecf` (única por `empresa_id` + `tipo_ecf`): `proximo_numero`, `rango_autorizado_desde`, `rango_autorizado_hasta` — la DGII asigna rangos de numeración por tipo de comprobante y empresa; el siguiente número se asigna con `UPDATE ... RETURNING` dentro de la misma transacción del evento (atómico, sin condición de carrera, igual de crítico que un número de cheque).

### 3. Documento e-CF, acuse e integridad

`comprobante_ecf`: un row por e-CF emitido. Incluye `tipo_ecf`, `ncf`, `documento` (jsonb — la estructura completa construida por `construirComprobanteEcf()`), `hash_integridad`, `estado` (ACEPTADO/RECHAZADO/CONTINGENCIA), `comprobante_origen_id` (auto-FK, NOT NULL solo para tipos 33/34 — así una nota de crédito referencia su e-CF de origen de forma verificable en BD, no solo en el JSON), `retener_hasta` (calculado con `calcularFechaLimiteRetencion()`).

`acuse_ecf`: 1:1 con `comprobante_ecf` cuando la DGII acepta. Incluye `payload` (jsonb, la respuesta cruda del middleware), `hash_integridad` (permite verificar que el acuse no fue alterado tras guardarse) y su propio `retener_hasta`.

**Plazo de retención adoptado:** 10 años desde la fecha de emisión (Código Tributario RD, art. 50 — conservación de documentación y registros). Se documenta aquí porque la norma exacta puede variar por tipo de contribuyente; si el contador del cliente exige un plazo distinto, se ajusta `ANOS_RETENCION_FISCAL_RD` en un solo lugar (`packages/localizacion-do`).

### 4. Contingencia y Representación Impresa (RI)

Si la llamada al middleware falla (excepción) o responde explícitamente que la DGII no está disponible, `EmisionEcfService` no bloquea la operación de la constructora: marca el comprobante `estado = 'CONTINGENCIA'` y genera una RI (`generarRepresentacionImpresa()`, función pura) con código de seguridad, número de RI y **fecha límite de regularización = fecha de emisión + 72 horas** (plazo estándar DGII para transmitir comprobantes emitidos en contingencia). No se crea `acuse_ecf` hasta que una sesión futura implemente la regularización (transmisión diferida) — está fuera del alcance pedido en esta sesión (solo se pidió que la contingencia "produzca una RI válida", no el ciclo completo de regularización).

### 5. Tipos 33/34 (notas de ajuste): emisión directa, sin documento comercial nuevo

Esta sesión no crea una tabla "nota_credito_cliente"/"nota_debito_cliente" como documento comercial de primera clase — eso es un futuro módulo de ajustes a clientes. En su lugar, `EmisionEcfService.emitirAjuste()` recibe un DTO mínimo (tipo 33 o 34, `comprobanteOrigenId`, montos, motivo) y emite el e-CF de ajuste directamente, validando que el origen exista, pertenezca al mismo tenant/empresa y sea un comprobante de venta (31/32). Esto satisface el requisito literal de la sesión ("una nota de crédito 34 referencia correctamente su e-CF de origen") sin construir un flujo comercial completo que nadie pidió todavía.

### 6. Catálogo DGII con vigencia real

`CatalogoDgiiService` gana `tipoEcfVigente(codigo, fecha)`: filtra por `valido_desde <= fecha AND (valido_hasta IS NULL OR valido_hasta >= fecha) AND activo`, no solo por `activo`. La comparación de código es case-insensitive porque el catálogo sembrado usa `e31`/`e32`/... (minúscula, Sesión 8) mientras que el resto del sistema (validador de Capa 1, `TipoNcf`) usa `E31`/`E32`/... — normalizar la comparación evita tocar datos ya sembrados en Capa 1.

### 7. Trazabilidad sin contabilidad duplicada

Se añade el tipo de evento `emision_ecf` al catálogo cerrado del ledger (P2/P8: todo hecho operativo se registra). **No genera asiento contable** — el asiento ya se generó en `emision_factura_cliente` (Sesión 3 Capa 2); emitir el e-CF es un hecho fiscal/documental posterior sobre la misma factura, no un nuevo hecho financiero. Se documenta como exento junto a `emision_oc`, `avance_partida`, etc. en `tipos-evento-requerido.ts` (ADR-0005).

---

## Alternativas consideradas

### Alternativa A: Certificado/secreto del emisor en la BD de aplicación (cifrado a nivel de columna)
Más simple de implementar (no depende de un HSM/KMS externo todavía inexistente en la infraestructura).

**Rechazada**: viola literalmente §22 de la arquitectura. Aunque el cifrado a nivel de columna parece equivalente, la norma del proyecto es explícita: el material de certificado nunca debe tocar la BD de aplicación, ni cifrado. Solo se permite un puntero externo.

### Alternativa B: Cliente HTTP real del middleware en esta sesión
Implementar ya el adaptador real contra un middleware e-CF de prueba.

**Rechazada**: no existe ningún middleware alcanzable en este entorno de desarrollo, y la sesión es explícita en que el middleware "ya existente y probado" es responsabilidad de otro ciclo de versiones. Construir un cliente HTTP contra un servicio que no existe aquí produciría código no verificable. El puerto queda definido y listo; el adaptador real se conecta sin tocar `localizacion-do` ni el servicio orquestador (ese es exactamente el punto de tener un puerto).

### Alternativa C (adoptada): Puerto + adaptador falso determinista, certificado solo por referencia, RI sin regularización automática
Ver Decisión.

---

## Consecuencias

**Positivas:**
- Cumple P6/P10 de la arquitectura: el día que entre otro país, se escribe otro paquete de localización sin tocar `apps/api/src/localizacion-do/emision-ecf.service.ts` (que es agnóstico de país salvo por el tipo concreto que importa de `localizacion-do`).
- El adaptador real del middleware se conecta sin modificar lógica fiscal ni el servicio orquestador — exactamente el desacople que pide la sesión.
- Ninguna fila de `configuracion_emisor_ecf` puede filtrar un certificado real, porque la columna nunca lo contiene.

**Negativas (alcance explícitamente diferido):**
- La regularización de comprobantes emitidos en contingencia (transmisión diferida tras las 72h) no se implementa aún — requiere un worker/outbox similar al de proyecciones asíncronas. Sesión futura.
- Las notas de crédito/débito no tienen todavía su propio documento comercial con flujo de aprobación — solo el e-CF de ajuste. Si el negocio necesita un proceso de aprobación para emitir una NC, es una sesión de `workflow` futura.
- El adaptador del middleware real (HTTP) no existe — cuando se conecte, se debe revisar que `IMiddlewareEcfClient` cubra todos los campos que el middleware real exige (este puerto se diseñó desde la documentación de arquitectura, no desde una especificación real del middleware).

---

## Implementación

- `packages/localizacion-do/src/ecf-emision.types.ts`, `ecf-builder.ts`, `ecf-contingencia.ts`, `ecf-integridad.ts`, `ecf-retencion-documental.ts`, `middleware-ecf.port.ts`
- `apps/api/src/db/schema/localizacion-do/configuracion_emisor_ecf.ts`, `secuencia_ecf.ts`, `comprobante_ecf.ts`, `acuse_ecf.ts`
- `apps/api/src/db/migrations/0026_emision_ecf.sql`
- `apps/api/src/localizacion-do/` — `middleware-ecf-fake.adapter.ts`, `configuracion-emisor-ecf.service.ts`, `secuencia-ecf.service.ts`, `emision-ecf.service.ts`, `emision-ecf.controller.ts`, `localizacion-do.module.ts`
- `apps/api/src/catalogos/catalogo-dgii.service.ts` — `tipoEcfVigente()`
- `packages/ledger/src/tipos-evento.ts`, `payload/emision-ecf.schema.ts` — tipo `emision_ecf`
- `packages/contabilidad/src/tipos-evento-requerido.ts` — comentario de exención
- `packages/core/src/permissions/permissions.catalog.ts` — `ECF_EMISION_READ`/`ECF_EMISION_WRITE`
