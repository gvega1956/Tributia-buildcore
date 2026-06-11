# TRIBUTIA BUILDCORE
## Arquitectura Maestra de la Plataforma — Documento de Diseño v1.0

**Plataforma operativa integral para empresas constructoras**
República Dominicana → Caribe y Centroamérica

---

# PARTE I — FUNDAMENTOS

## 1. Tesis del producto

Tributia BuildCore no es un ERP con módulos de construcción, ni un software de obra con contabilidad pegada. Es una sola plataforma donde **cada hecho operativo de la constructora se registra una única vez** y desde ahí fluye, sin intervención humana y sin duplicación, hacia el inventario, el costo del proyecto, el presupuesto, la contabilidad, la tesorería y los tableros ejecutivos.

La frase que define el producto y contra la cual se valida cada decisión de diseño:

> **"Un hecho, un registro, todas las consecuencias automáticas."**

Si una funcionalidad propuesta obliga a digitar el mismo dato dos veces, o produce dos versiones de la misma verdad, está mal diseñada y se rechaza.

## 2. Debilidades reales de los competidores y respuesta de diseño

Este análisis es la justificación de cada decisión arquitectónica. No se compite "teniendo más módulos"; se compite resolviendo lo que ellos estructuralmente no pueden resolver.

| Competidor | Fortaleza | Debilidad estructural | Respuesta de Tributia BuildCore |
|---|---|---|---|
| **Procore** | Gestión de obra (RFI, submittals, planos) de clase mundial | No tiene contabilidad propia: depende de integrar ERP externo (Sage, QuickBooks, Viewpoint). El costo real siempre llega tarde y desincronizado. Precio alto. Cero localización RD/LATAM. | Contabilidad **nativa**, generada por eventos. El costo real existe en el mismo segundo que el hecho operativo. Localización DGII/TSS de fábrica. |
| **Buildertrend** | Fácil de usar, fuerte en residencial | Financieramente superficial; débil en obra pesada, equipos y subcontratos complejos. | Profundidad financiera y de maquinaria sin perder usabilidad. |
| **Contractor Foreman** | Precio bajo, muchos módulos | Módulos anchos pero poco profundos; integraciones internas frágiles; reportería pobre. | Menos módulos al inicio, pero cada uno profundo y sobre el mismo modelo de datos. |
| **SAP / Oracle (ERP genérico)** | Robustez financiera | Implementaciones de 12–24 meses, costo prohibitivo para constructora mediana, sin app de campo real, requiere consultores permanentes. | Implementación en semanas con plantillas por tipo de constructora; campo offline-first incluido. |
| **Software local RD** (facturadores, contables) | Cumplen DGII | No conocen la obra: no hay partidas, ni avance, ni equipos, ni subcontratos. La constructora vive en Excel igual. | El cumplimiento DGII es la capa final de un flujo que nace en la obra, no un sistema aparte. |

**Síntesis:** el espacio vacío del mercado es la intersección de tres cosas que hoy nadie ofrece junta: (1) gestión de obra profunda, (2) contabilidad y nómina nativas, (3) localización dominicana real (e-CF, 606/607, TSS, Código de Trabajo). Tributia BuildCore se construye exactamente sobre esa intersección.

## 3. Los diez principios de arquitectura

Estos principios son obligatorios. Toda decisión futura de diseño debe poder justificarse contra ellos.

**P1 — Una sola base de datos, un solo modelo.**
No existen "integraciones internas" entre módulos. Los módulos son vistas y procesos sobre el mismo esquema. La integración no es una funcionalidad: es la ausencia de separación.

**P2 — El Evento Operativo es la columna vertebral.**
Todo hecho de negocio (una recepción de material, una hora de excavadora, un avance de partida, un pago) se registra como un **evento inmutable** en una bitácora central (Event Ledger). Inventario, costos, contabilidad y dashboards no son "módulos que se actualizan": son **proyecciones derivadas** de esa bitácora. Esto garantiza que nunca puedan descuadrar entre sí, porque todos leen de la misma fuente.

**P3 — El Proyecto es la dimensión obligatoria de costo.**
Ningún costo, ingreso, consumo o hora puede existir sin imputación: o pertenece a un proyecto (y a una partida dentro de él), o pertenece explícitamente a un centro de costo administrativo. No existe el costo huérfano.

**P4 — Contabilidad por reglas, nunca digitada.**
Cada tipo de evento tiene una **regla contable parametrizable** que genera su asiento de partida doble automáticamente. El contador configura reglas y revisa excepciones; no digita asientos operativos. La contabilidad manual queda reservada para ajustes, y todo ajuste queda auditado.

**P5 — La EDT/Partida es el lenguaje común.**
La Estructura de Desglose de Trabajo (partidas presupuestarias) es el eje que conecta presupuesto → compras → consumo → avance físico → costo real → facturación al cliente. La misma partida que se presupuestó es la que se compra, se ejecuta, se mide y se cobra. Sin re-mapeos.

**P6 — Multi-tenant, multi-empresa, multi-moneda, multi-país desde el esquema.**
Una sola instancia sirve a muchas constructoras (tenants), cada una pudiendo tener varias empresas (RNC distintos), operar en DOP y USD, y —a futuro— en otros países. La localización (impuestos, nómina, comprobantes) es un **paquete enchufable por país**, nunca código incrustado en el núcleo. RD es el primer paquete; el segundo país no debe requerir tocar el núcleo.

**P7 — El campo funciona sin internet.**
La app de obra es offline-first: captura avances, fotos, consumos, asistencia y checklists sin señal, y sincroniza con resolución de conflictos cuando la recupera. Una obra en Constanza o un proyecto vial no pueden depender de cobertura.

**P8 — Auditoría total e inmutabilidad.**
Nada se borra. Todo se versiona o se reversa con contra-evento. Cada registro conserva quién, cuándo, desde dónde y qué cambió. Esto no es solo cumplimiento: es el argumento de venta ante socios, bancos y fiscalizaciones.

**P9 — Permisos por rol × proyecto × empresa.**
Un ingeniero residente ve su obra completa pero no la rentabilidad consolidada; el CFO ve todo lo financiero; un subcontratista invitado ve solo sus contratos y avances. La matriz de permisos es granular en tres dimensiones y configurable sin programar.

**P10 — API-first y extensible.**
Toda función de la interfaz existe primero como API documentada. Esto habilita la app móvil, futuras integraciones (bancos, GPS de terceros, BIM) y el ecosistema, sin reescribir nada.

---

# PARTE II — EL MODELO DE DATOS CENTRAL

## 4. Entidades maestras (el esqueleto)

Estas entidades existen una sola vez en toda la plataforma y todos los núcleos las referencian. Su diseño correcto es el 50% del éxito del sistema.

### 4.1 Jerarquía organizacional
```
Tenant (la constructora cliente de Tributia BuildCore)
└── Empresa (RNC / razón social — puede haber varias)
    └── Sucursal / Oficina
        └── Centro de Costo administrativo
```

### 4.2 Tercero unificado
Una sola entidad **Tercero** con roles activables: Cliente, Proveedor, Subcontratista, Empleado-relacionado, Banco, Institución estatal. Un mismo RNC puede ser cliente en un proyecto y proveedor en otro sin duplicarse. Atributos fiscales RD: RNC/cédula, tipo de contribuyente, retenciones aplicables, condición ante DGII.

### 4.3 Proyecto (la entidad reina)
```
Proyecto
├── Datos generales: cliente, contrato, monto, moneda, fechas, ubicación geográfica, tipo de obra
├── EDT (Estructura de Desglose de Trabajo)
│   └── Capítulo → Partida → Sub-partida
│       └── APU (Análisis de Precio Unitario)
│           ├── Materiales (cantidad × precio)
│           ├── Mano de obra (rendimientos × tarifas)
│           ├── Equipos (horas × tarifa horaria)
│           └── Subcontratos
├── Presupuesto base (línea inmutable de control)
├── Presupuesto vigente (= base + órdenes de cambio aprobadas)
├── Cronograma (actividades ↔ partidas, dependencias, ruta crítica)
├── Equipo del proyecto (roles y permisos)
└── Estado: Prospecto → Licitación → Adjudicado → En ejecución → Cierre → Garantía → Cerrado
```
El ciclo de estados es clave: **el proyecto nace en el CRM como prospecto y muere en contabilidad como cerrado, siendo siempre el mismo registro.** Nunca se "exporta" de un módulo a otro.

### 4.4 Catálogos transversales
- **Catálogo de insumos** (materiales, con unidades, equivalencias y familias)
- **Catálogo de equipos y maquinaria** (con tarifas horarias internas)
- **Catálogo de mano de obra** (oficios y tarifas)
- **Plan de cuentas contable** (plantilla RD precargada, adaptable)
- **Catálogos DGII** (tipos de e-CF, códigos de bienes/servicios, ITBIS, retenciones) — versionados, porque la DGII los cambia

### 4.5 El Event Ledger (la innovación estructural)
Tabla central, inmutable, de alto volumen:

```
EventoOperativo
├── id, timestamp, usuario, dispositivo, geolocalización (si aplica)
├── tipo_evento (catálogo cerrado: ~80 tipos)
├── tenant / empresa / proyecto / partida / centro_costo
├── referencias (documento origen: OC, recepción, parte diario, nómina...)
├── payload (los datos del hecho)
└── estado: registrado → validado → contabilizado / reversado
```

**Tipos de evento (muestra):** `recepcion_material`, `consumo_material`, `transferencia_almacen`, `avance_partida`, `hora_equipo`, `hora_personal`, `recepcion_factura_proveedor`, `emision_factura_cliente`, `pago_emitido`, `cobro_recibido`, `avance_subcontrato`, `retencion_aplicada`, `combustible_cargado`, `mantenimiento_ejecutado`, `orden_cambio_aprobada`, `ajuste_inventario`...

De cada evento se derivan automáticamente, mediante motores de proyección:
1. **Movimiento de inventario** (si aplica)
2. **Línea de costo real del proyecto** (imputada a partida)
3. **Asiento contable** (vía regla contable del tipo de evento)
4. **Actualización de comprometido/devengado/pagado** contra presupuesto
5. **Refresco de KPIs** del proyecto y consolidados

Este es el mecanismo que hace imposible que "el almacén diga una cosa, el costo otra y la contabilidad otra" — la falla número uno de todos los sistemas que la competencia integra por interfaces.

## 5. El flujo canónico (la demo que vende el producto)

```
1. Almacenista en obra (app móvil, sin señal) registra:
   salida de 50 fundas de cemento → partida "Hormigón armado N2"
                      ↓ (sincroniza)
2. Event Ledger: evento consumo_material
                      ↓ (automático, < 1 segundo)
3. Inventario almacén de obra: −50 fundas
4. Costo real del proyecto: + RD$ 21,500 en partida Hormigón N2
5. Presupuesto: partida consume 61% de lo previsto con 54% de avance físico
   → alerta amarilla de desviación al residente
6. Contabilidad: asiento automático
   (DB) Costo de obra en proceso — Proyecto Torre Norte
   (CR) Inventario de materiales
7. Dashboard del CEO: margen proyectado del proyecto recalculado
8. Flujo de caja proyectado: sin cambio (el pago ya ocurrió al comprar)
```
Ocho consecuencias, cero re-digitación, cero conciliación posterior. **Esta secuencia, mostrada en vivo, es el argumento comercial central.**

---

# PARTE III — LOS NÚCLEOS FUNCIONALES

Catorce núcleos sobre el mismo modelo de datos. Para cada uno: propósito, entidades, procesos clave, eventos que emite y el detalle que lo hace superior a lo existente.

## 6. Núcleo Comercial (CRM de construcción)

**Propósito:** capturar la oportunidad y convertirla en proyecto sin romper la continuidad del dato.

- **Entidades:** Prospecto, Oportunidad, Licitación, Visita técnica, Propuesta/Cotización, Contrato.
- **Procesos:** embudo comercial → registro de licitación (pública o privada, con fechas y garantías) → estimación rápida vinculada al Motor de Presupuesto → propuesta → adjudicación.
- **Al ganar:** la oportunidad **se convierte en el mismo registro de Proyecto** (cambio de estado, no copia). El presupuesto de la propuesta se congela como Presupuesto Base.
- **Diferenciador:** historial completo de licitaciones perdidas con precios, para calibrar futuras ofertas (¿contra quién pierdo y por cuánto?). Los CRMs genéricos no entienden licitaciones; los softwares de obra no tienen CRM.

## 7. Motor de Presupuesto y Estimación

**Propósito:** el cerebro económico. Aquí se gana o se pierde el margen antes de poner un bloque.

- **Entidades:** EDT, Partida, APU, Insumo, Rendimiento, Tarifa, Versión de presupuesto.
- **Procesos:**
  - Biblioteca de APUs reutilizable y versionada (la constructora acumula su conocimiento: sus rendimientos reales, no los teóricos de un manual).
  - Presupuestación por composición: partida = Σ(materiales + MO + equipos + subcontratos) + indirectos + imprevistos + utilidad.
  - Análisis de indirectos del proyecto (campamento, supervisión, seguros, fianzas) como capítulo propio.
  - Comparador de versiones (qué cambió entre la oferta v3 y la v7).
  - **Retroalimentación automática:** al cerrar cada proyecto, los rendimientos y costos reales actualizan (con aprobación) la biblioteca de APUs. El sistema aprende de cada obra. Ningún competidor cierra este ciclo.
- **Control en ejecución — la tríada por partida:**
  - **Presupuestado** (vigente) vs **Comprometido** (OCs y subcontratos firmados) vs **Devengado** (consumido/ejecutado) vs **Pagado**.
  - Esta tríada en tiempo real por partida es el tablero que los gerentes de obra hoy arman a mano en Excel cada viernes.

## 8. Núcleo de Gestión de Obra

**Propósito:** la ejecución física. Competencia directa con Procore, con la diferencia de que aquí cada acción tiene consecuencia financiera inmediata.

- **Entidades:** Cronograma, Actividad, Hito, Parte Diario (Daily Log), Avance de partida, RFI, Submittal, Punch List, Inspección, Incidente de seguridad, Documento/Plano (con control de versiones), Fotografía georreferenciada.
- **Procesos clave:**
  - **Parte diario estructurado:** clima, personal presente (propio y subcontratado), equipos operando con horas, actividades ejecutadas, avances por partida, novedades. Un solo formulario móvil alimenta nómina, costo de equipos y avance físico simultáneamente.
  - **Medición de avance:** por cantidad de obra ejecutada (m³, m², ml, unidades) contra la cantidad presupuestada de la partida. El % de avance físico nunca es una opinión: es cantidad medida / cantidad total.
  - **Valor Ganado (EVM) nativo:** PV, EV, AC, CPI, SPI por partida y por proyecto, calculados solos porque presupuesto, avance y costo viven en el mismo modelo. Procore necesita un ERP externo y un analista para esto.
  - **RFI y Submittals** con responsables, vencimientos, impacto (¿este RFI bloquea ruta crítica?) y trazabilidad completa.
  - **Curvas S** automáticas (programado vs ejecutado vs costo).
- **Cronograma:** Gantt con dependencias y ruta crítica, **vinculado a partidas** (una actividad consume partidas; el retraso de una actividad recalcula la proyección de costo indirecto). Importación/exportación MS Project y Primavera P6 para no pelear con el hábito del mercado.

## 9. Órdenes de Cambio (Change Orders)

**Propósito:** el mayor punto de fuga de margen de la industria, resuelto como flujo formal.

- **Flujo:** Solicitud (origen: cliente, diseño, campo, imprevisto) → Estimación de impacto (el motor de presupuesto calcula material + MO + equipos + tiempo) → Propuesta económica al cliente → Aprobación (firma digital) → **El presupuesto vigente y el cronograma se actualizan automáticamente; el contrato registra la enmienda.**
- **Regla de oro del sistema:** trabajo no cubierto por presupuesto vigente genera alerta. Si el residente registra avance en algo que no existe como partida, el sistema lo detecta y fuerza el flujo de orden de cambio. **Así se elimina el trabajo ejecutado y nunca cobrado**, que en constructoras medianas se come 3–8% del contrato.
- Historial completo: cuánto del valor final del contrato vino de cambios, por causa y por responsable. Oro puro para negociar contratos futuros.

## 10. Núcleo de Compras (Procurement)

**Propósito:** ciclo completo requisición → pago, con el presupuesto como guardián automático.

- **Flujo:**
```
Requisición (obra, app móvil, imputada a partida)
  → Validación automática contra presupuesto disponible de la partida
     (si excede: flujo de aprobación excepcional, no bloqueo ciego)
  → Consolidación de requisiciones (compras agrupa demandas de varias obras)
  → Solicitud de cotización a proveedores (portal o correo estructurado)
  → Cuadro comparativo automático (precio, plazo, historial del proveedor)
  → Orden de Compra (aprobación por matriz de montos)
  → Recepción en almacén (total/parcial, con foto y conduce)
  → Registro de factura del proveedor (e-CF recibido, validado contra OC y recepción: el "match de 3 vías")
  → Cuenta por pagar → Programación de pago → Pago
```
- Cada flecha es un evento en el Ledger; cada evento actualiza comprometido/devengado/pagado de la partida y genera su asiento.
- **Scoring de proveedores automático:** % entregas a tiempo, % rechazos de calidad, variación de precio. ("Este proveedor entrega tarde el 35% de las veces" deja de ser intuición.)
- Anticipos a proveedores con amortización automática contra facturas.

## 11. Núcleo de Inventario y Almacenes

**Propósito:** saber qué hay, dónde, de quién es el costo y quién lo movió — incluyendo almacenes de obra temporales.

- **Entidades:** Almacén (central, de obra, en tránsito), Ubicación, Lote, Movimiento, Conteo físico, Herramienta asignada.
- **Procesos:** recepciones, despachos a partida, transferencias entre almacenes/obras, devoluciones, conteos cíclicos con ajuste auditado, kárdex por insumo con costo promedio ponderado (o el método configurado).
- **Gestión de herramientas menores:** asignación a empleado/cuadrilla con responsabilidad firmada digitalmente; descuento por pérdida ligado a nómina (configurable según política y ley laboral).
- **Diferenciador:** el almacén de obra se abre y se cierra con el proyecto; al cierre, el sobrante se transfiere o liquida y su costo se reconcilia contra las partidas. El "material que desapareció al final de la obra" se vuelve visible.

## 12. Núcleo de Equipos y Maquinaria (EAM/CMMS)

**Propósito:** los activos más caros de la constructora, gestionados como centro de costo productivo.

- **Entidades:** Equipo (con ficha técnica completa), Horómetro/Odómetro, Plan de mantenimiento, Orden de trabajo de taller, Repuesto, Tarifa horaria interna.
- **Procesos:**
  - Mantenimiento **preventivo por uso real** (cada 250 h de horómetro, no cada X días de calendario), con alertas y generación automática de órdenes de taller.
  - Mantenimiento correctivo con costos de repuestos (desde inventario) y mano de obra de taller.
  - **Tarifa horaria interna:** cada equipo tiene un costo/hora calculado (depreciación + mantenimiento + combustible + seguro + operador). Cuando el parte diario registra 6 horas de la CAT-320 en la partida "Movimiento de tierra", el proyecto recibe ese costo automáticamente. **Así se sabe si conviene tener la excavadora o alquilarla** — pregunta que casi ninguna constructora mediana puede responder con datos.
  - Renta de equipos a terceros y entre proyectos propios (facturación interna).
  - Costo total de propiedad (TCO) por equipo y decisión de reemplazo basada en curva de costo de mantenimiento.

## 13. Núcleo de Flota y Combustible

**Propósito:** vehículos livianos y pesados, el gasto que más se fuga.

- Vehículos con expediente completo: seguro, revisado, placa, asignación.
- **Integración GPS por API** (proveedores existentes en RD; no construir hardware): rutas, geocercas por obra (alerta si el camión de volteo salió del polígono), horas de motor, velocidad.
- **Control de combustible cruzado:** litros despachados (estación o tanque propio) vs kilómetros/horas GPS vs rendimiento esperado del vehículo → desviaciones señaladas automáticamente. El robo de combustible se detecta por matemática, no por sospecha.
- Cada gasto de flota se imputa: a proyecto (si el vehículo está asignado a obra) o a centro administrativo.

## 14. Núcleo de Subcontratos

**Propósito:** el otro gran dolor no resuelto. Los subcontratistas ejecutan 40–70% de muchas obras y se administran en WhatsApp.

- **Entidades:** Subcontrato (alcance = partidas asignadas, monto, retención %, anticipo), Cubicación/Avance de subcontrato, Retención acumulada, Liquidación.
- **Flujo:** contrato con alcance por partidas → anticipo (con asiento y amortización) → cubicaciones periódicas aprobadas por el residente (con evidencia fotográfica) → factura del subcontratista validada contra cubicación → retención automática (garantía, ISR según aplique) → pago → liquidación final con devolución de retenciones.
- **Portal del subcontratista** (acceso limitado): ve su contrato, sube su cubicación, su factura y sus documentos de cumplimiento (TSS al día, seguro). Documento vencido = pago bloqueado automáticamente. Esto protege a la constructora de solidaridad laboral — riesgo legal real en RD.

## 15. Núcleo de RRHH y Nómina Dominicana

**Propósito:** nómina de construcción RD nativa. Ningún software de obra internacional la tiene; ningún software de nómina local entiende la obra.

- **Entidades:** Empleado, Contrato (fijo, por obra, móvil/jornalero), Cuadrilla, Asistencia, Novedad, Nómina (semanal/quincenal/mensual coexistiendo), Préstamo, Liquidación.
- **Captura en campo:** asistencia desde el parte diario o biométrico móvil con geolocalización; las horas se imputan a partida (la mano de obra es costo directo de la partida, no un gasto global).
- **Cálculo RD completo:**
  - TSS: SFS, AFP, SRL (con topes salariales vigentes), INFOTEP.
  - ISR por escala anualizada con exenciones.
  - Regalía pascual (salario 13), bonificación (participación de beneficios según Código de Trabajo), vacaciones, preaviso y cesantía en liquidaciones.
  - Horas extras (35%, 100%), trabajo nocturno, días feriados según ley.
  - Pago por ajuste/destajo (por m² terminado) coexistiendo con jornal — realidad universal de la construcción dominicana.
- **Salidas oficiales:** archivo de autodeterminación TSS, formato DGT, reportes para el Ministerio de Trabajo, volantes de pago digitales.
- **Provisiones automáticas:** cada nómina genera el asiento de provisión de regalía, bonificación y prestaciones — el pasivo laboral real visible cada mes, no la sorpresa de diciembre.

## 16. Núcleo Financiero (Contabilidad, CxC, CxP, Tesorería)

**Propósito:** la contabilidad como proyección automática de la operación. El contador supervisa; no transcribe.

- **Contabilidad general:** plan de cuentas plantilla RD; asientos generados por reglas desde el Event Ledger; asientos manuales solo para ajustes (auditados); cierres mensuales con checklist; multi-empresa con consolidación; multimoneda DOP/USD con diferencia cambiaria automática.
- **Cuentas por cobrar:** facturación al cliente por **cubicación/certificación de avance** (el estándar de la industria): avance físico aprobado → certificación → factura e-CF → retenciones del cliente (si es Estado: 5% ISR, ITBIS retenido según aplique) → cobro → antigüedad de saldos por proyecto.
- **Cuentas por pagar:** nacen solas del ciclo de compras y subcontratos; programación de pagos por prioridad y flujo de caja disponible.
- **Tesorería:** bancos, conciliación bancaria (importación de estados, matching automático), caja chica de obra con reposición documentada (dolor enorme y universal), **flujo de caja proyectado por proyecto** (cobros esperados por cronograma de certificaciones vs pagos comprometidos por OCs, subcontratos y nómina). La pregunta "¿puedo arrancar esta obra sin ahogarme?" respondida con datos.
- **Costos financieros por proyecto:** intereses de líneas y fianzas imputados al proyecto que los causó. El margen real, no el margen ilusorio.

## 17. Núcleo Fiscal RD (la capa de localización)

**Propósito:** cumplimiento DGII de extremo a extremo, montado sobre el middleware e-CF ya existente.

- **Emisión e-CF:** integración del middleware probado; cada empresa del tenant emite con su propio certificado digital y su autorización de emisor electrónico (responsabilidad fiscal del cliente, como fue decidido). Tipos: 31, 32, 33, 34, 41, 43, 44, 45, 46, 47 según operación. Manejo de contingencia y representación impresa (RI).
- **Recepción e-CF:** validación de comprobantes de proveedores (estructura, vigencia, RNC) antes de aceptarlos a CxP — escudo contra facturas inválidas que luego la DGII rechaza como gasto.
- **Reportes:** 606 (compras), 607 (ventas), 608 (anulados), 623 (retenciones del Estado), IT-1, anexos IR-2 — generados desde los mismos eventos, sin re-digitación.
- **Retenciones automáticas:** ISR a personas físicas, 5% a proveedores del Estado, ITBIS retenido a servicios profesionales — por regla, según el tipo de tercero y operación.
- **Arquitectura enchufable:** todo este núcleo implementa una interfaz genérica `LocalizaciónFiscal`. El día que entre Panamá o Costa Rica, se escribe otro paquete sin tocar el resto.

## 18. Núcleo de BI y Capa de Inteligencia

**Propósito:** convertir el Event Ledger en decisiones. Se construye al final, pero su materia prima (datos limpios e íntegros) se acumula desde el día uno — esa es la ventaja de la arquitectura.

- **Dashboards por rol (tiempo real, no reportes nocturnos):**
  - **CEO/Dueño:** margen proyectado por proyecto, flujo de caja consolidado 13 semanas, top 5 riesgos, comparativo presupuesto vs real de toda la cartera.
  - **Director de obra:** CPI/SPI por proyecto, partidas en desviación, RFIs vencidos, productividad por cuadrilla.
  - **CFO:** posición de caja, CxC vencidas por cliente, pasivo laboral provisionado, exposición por proyecto.
  - **Compras:** requisiciones pendientes, OCs por vencer, scoring de proveedores.
- **Inteligencia operativa (fase final, sobre datos propios acumulados):**
  - Proyección de sobrecosto por partida (tendencia de CPI + compromisos pendientes).
  - Alerta temprana de retraso (velocidad de avance vs curva planificada).
  - Predicción de falla de equipos (patrón de correctivos + horómetro).
  - Confiabilidad de proveedores y de subcontratistas con datos, no impresiones.
  - Benchmark interno: rendimiento real de hormigón armado de esta obra vs el histórico de la empresa.
- **Regla de honestidad del producto:** ninguna "IA" se promete sin datos que la sustenten. Primero analítica descriptiva impecable; lo predictivo llega cuando el ledger tenga masa crítica. Esto también es diferenciación: los competidores venden IA de folleto.

## 19. Núcleo de Plataforma (transversal)

Los servicios que todos los núcleos consumen:

- **Identidad y permisos:** SSO, MFA, matriz rol × proyecto × empresa, perfiles plantilla (residente, almacenista, contador, subcontratista...).
- **Motor de flujos de aprobación:** configurable por monto, tipo de documento y jerarquía, con delegaciones y vencimientos. Un solo motor para OCs, pagos, órdenes de cambio, requisiciones y nómina.
- **Gestor documental:** versiones, vencimientos (pólizas, fianzas, contratos), firma electrónica, vínculo a cualquier entidad.
- **Notificaciones:** in-app, correo, WhatsApp Business API (canal dominante en RD para alertas operativas).
- **Auditoría:** bitácora completa de accesos y cambios, exportable para auditores externos.
- **Importadores:** Excel de presupuestos existentes, catálogos, saldos iniciales contables, maestro de empleados — la migración es el momento donde mueren las implementaciones; se diseña como producto, no como servicio improvisado.
- **API pública documentada** + webhooks salientes.

---

# PARTE IV — ARQUITECTURA TÉCNICA

## 20. Capas del sistema

```
┌─────────────────────────────────────────────────────────┐
│  EXPERIENCIAS                                            │
│  Web (back-office) · App móvil offline-first (campo)     │
│  Portal subcontratista · Portal cliente (avance de obra) │
├─────────────────────────────────────────────────────────┤
│  API GATEWAY  (REST/GraphQL · auth · rate limit · docs)  │
├─────────────────────────────────────────────────────────┤
│  SERVICIOS DE DOMINIO (modular monolith)                 │
│  Comercial · Presupuesto · Obra · Compras · Inventario   │
│  Equipos · Flota · Subcontratos · RRHH · Finanzas        │
├─────────────────────────────────────────────────────────┤
│  NÚCLEO DE EVENTOS                                       │
│  Event Ledger · Bus interno · Motores de proyección      │
│  (inventario, costos, contabilidad, KPIs)                │
├─────────────────────────────────────────────────────────┤
│  SERVICIOS TRANSVERSALES                                 │
│  Permisos · Flujos aprobación · Documental ·             │
│  Notificaciones · Auditoría · Localización fiscal ⇄      │
│  Middleware e-CF (existente)                             │
├─────────────────────────────────────────────────────────┤
│  DATOS                                                   │
│  PostgreSQL multi-tenant (RLS) · Objetos S3 (fotos/docs) │
│  Réplica de lectura para BI · Cache                      │
└─────────────────────────────────────────────────────────┘
```

## 21. Decisiones técnicas con su justificación

| Decisión | Elección | Por qué |
|---|---|---|
| Forma del backend | **Monolito modular**, no microservicios | Un equipo pequeño con microservicios muere en infraestructura. Módulos con fronteras estrictas (cada uno su esquema lógico, comunicación solo por eventos/interfaces) dan la disciplina de microservicios sin su costo. Si un módulo necesita escalar aparte algún día, ya está desacoplado para extraerse. |
| Multi-tenancy | **BD compartida + Row Level Security** (PostgreSQL) | Aislamiento garantizado por el motor de BD (no por disciplina del programador), costo operativo bajo, y opción de "tenant premium con BD dedicada" para clientes grandes que lo exijan. |
| Consistencia | Eventos con **proyecciones síncronas críticas** (inventario, presupuesto) y asíncronas no críticas (KPIs, notificaciones) | El almacenista debe ver el stock descontado al instante; el dashboard puede tardar segundos. Pragmatismo sobre pureza de event-sourcing. |
| Móvil | Una app multiplataforma con base de datos local y cola de sincronización | Offline-first real (P7). Resolución de conflictos por reglas de negocio (ej.: dos consumos del mismo material se suman; dos ediciones del mismo avance, gana la del rol superior con alerta). |
| e-CF | Middleware existente como **servicio interno independiente** con su propio ciclo de versiones | La DGII cambia formatos; el middleware se actualiza sin tocar Tributia BuildCore. Además queda reutilizable para NetCore u otros productos. |
| Reportería pesada | Réplica de lectura + modelo dimensional ligero | El BI nunca compite por recursos con la operación. |
| Infraestructura | Nube con IaC (infraestructura como código), backups georredundantes, RPO ≤ 15 min | Una constructora que pierde su contabilidad y sus cubicaciones quiebra. La durabilidad del dato es parte del producto vendible. |

## 22. Seguridad y cumplimiento

- Cifrado en tránsito y en reposo; certificados digitales de clientes en bóveda de secretos (HSM/KMS), jamás en la BD de aplicación.
- Ley 172-13 (protección de datos personales RD) considerada en el diseño de RRHH.
- Retención documental fiscal: e-CF y acuses conservados los plazos que exige la norma, con verificación de integridad.
- Pruebas de penetración anuales y bitácora de auditoría inmutable — argumentos de venta ante clientes corporativos y el Estado.

---

# PARTE V — ESTRATEGIA DE CONSTRUCCIÓN

## 23. El principio rector

**Se diseña el 100% desde el día 1. Se construye en capas. Cada capa se valida con obra real antes de la siguiente.**

El modelo de datos completo (Partes II y III) se modela íntegro al inicio: todas las entidades, todas las relaciones, todos los tipos de evento. Lo que se difiere es la *interfaz y los procesos* de los núcleos tardíos, no su lugar en el esquema. Así jamás habrá que "integrar" lo nuevo: ya vive en la misma casa, solo falta amueblarle el cuarto.

## 24. Capas de construcción

**Capa 0 — Cimientos (sin esto no hay nada):**
Plataforma transversal: tenancy, identidad/permisos, Event Ledger, motor de proyecciones, motor de reglas contables, flujos de aprobación, documental, auditoría, importadores. Modelo de datos completo desplegado.

**Capa 1 — El corazón económico de la obra:**
Proyectos + EDT/Presupuesto (motor completo) + Compras + Inventario + Avance físico/Parte diario + tríada presupuestado/comprometido/devengado + app móvil básica (requisición, recepción, consumo, avance, fotos).
*Criterio de salida: una constructora real controla una obra real de punta a punta y declara que dejó el Excel de costos.*

**Capa 2 — El dinero formal:**
Contabilidad activada (las reglas ya venían generando asientos en silencio desde la Capa 1 — se encienden y se validan con el contador del cliente), CxC con cubicaciones y facturación e-CF (middleware), CxP, tesorería y conciliación, reportes 606/607/IT-1.
*Criterio de salida: el cierre mensual contable del cliente sale del sistema sin Excel paralelo.*

**Capa 3 — Las personas y los terceros:**
Nómina dominicana completa + Subcontratos con portal + CRM/licitaciones formalizado.
*Criterio de salida: la TSS se autodetermina desde el sistema; un subcontratista cobra vía el portal.*

**Capa 4 — Los fierros:**
Equipos/mantenimiento + Flota/GPS/combustible + tarifas horarias imputando a partidas.

**Capa 5 — La inteligencia:**
Dashboards avanzados por rol, EVM consolidado de cartera, y los modelos predictivos *cuando el ledger acumulado lo sustente*.

## 25. Reglas de disciplina (lo que protege el proyecto de sí mismo)

1. **Ninguna capa empieza sin que la anterior esté en uso real.** Uso real = una constructora operando, no una demo.
2. **3 a 5 constructoras "socias de diseño"** desde la Capa 1: usan, pagan (aunque sea poco), exigen y validan. Sus datos reales son el combustible de la Capa 5.
3. **El esquema se respeta:** si un desarrollo pide romper un principio (P1–P10), se rediseña el desarrollo, no el principio.
4. **Todo cambio de la DGII tiene prioridad absoluta** sobre cualquier funcionalidad nueva. El cumplimiento fiscal roto mata la confianza más rápido que cualquier bug.
5. **Cada funcionalidad nace con su importador y su reporte.** Si no se puede migrar hacia ella ni medirla, no está terminada.

## 26. Definición honesta de "superar a los existentes"

Tributia BuildCore no superará a Procore en gestión documental de planos en su versión 1, ni a SAP en consolidación financiera multinacional. No lo necesita. Supera a todos en la única dimensión que ninguno puede copiar sin reescribirse desde cero:

> **Es el único sistema donde la obra, el dinero y el fisco dominicano son el mismo dato.**

Esa frase es la estrategia completa. Todo lo demás de este documento existe para hacerla verdad.

---

*Documento de arquitectura v1.0 — Tributia BuildCore. Base para el modelado de datos detallado, los wireframes por núcleo y el plan de trabajo de la Capa 0.*
