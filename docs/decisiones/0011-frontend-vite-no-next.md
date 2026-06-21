# ADR-0011: Frontend SPA con Vite en vez de Next.js

**Estado:** Aceptado  
**Fecha:** 2026-06-20  
**Contexto:** apps/web — capa de interfaz de Tributia BuildCore

## Decisión

El frontend de Tributia BuildCore es una **SPA pura** construida con Vite + React + TypeScript, con React Router para el routing del lado del cliente. Se descarta Next.js.

## Contexto

`apps/web` arrancó con Next.js 15 por el generador por defecto durante el andamiaje inicial, sin una decisión técnica consciente. Al revisar los requisitos reales del frontend antes de construir los componentes base, queda claro que Next.js no aporta ninguna ventaja a este proyecto.

## Razones para no usar Next.js

1. **No necesita SSR.** Tributia BuildCore es un ERP interno detrás de login. Nada requiere renderizado en servidor: no hay SEO, no hay crawlers, no hay páginas públicas.

2. **No necesita SSG.** No hay páginas estáticas. Todo el contenido es dinámico y acotado por tenant + empresa + proyecto activos.

3. **No necesita el App Router.** El sistema de layouts anidados, Server Components y Suspense boundaries de Next.js añaden complejidad sin beneficio en este caso.

4. **Convención incorrecta para SPA empresariales.** El plan de arquitectura del frontend especificó desde el inicio Vite + React + React Router. Next.js fue una desviación accidental del generador.

5. **No hay `_next/` en producción.** El API de NestJS ya sirve el backend. El frontend se despliega como archivos estáticos (S3 + CDN, o servido por nginx). Un `build` de Vite genera exactamente eso: un directorio `dist/` con HTML, JS y CSS listos para servir.

## Razones para usar Vite

1. **Velocidad.** HMR sub-segundo en desarrollo. Build con Rollup, optimizado para producción.

2. **Simplicidad.** Sin magia de framework: lo que importas es lo que ejecutas. El bundle de producción es predecible.

3. **Control total del routing.** React Router v6 da control explícito sobre rutas protegidas, layouts anidados y navegación — sin la capa de abstracción de Next.js encima.

4. **Alineado con el stack.** TanStack Query, TanStack Table, React Hook Form, Zustand, react-hook-form — todos son agnósticos de framework y funcionan igual en Vite que en Next. No hay ventaja en combinarlos con Next.js para un ERP detrás de login.

5. **Sin conflictos de `'use client'`.** En Next.js App Router, cada componente que usa hooks requiere el pragma `'use client'`. En una SPA con Vite, todo es client-side por definición.

## Consecuencias

- El proyecto `apps/web` no tiene `pages/` ni `app/` de Next.js. La entrada es `index.html` → `src/main.tsx`.
- El routing es declarativo en `src/App.tsx` con `<BrowserRouter>` + `<Routes>`.
- Las rutas protegidas se implementan con un componente `<ProtectedRoute>` wrapper, no con middleware de Next.js.
- El build produce `apps/web/dist/` — archivos estáticos listos para deploy.
- En producción, el servidor web (nginx, S3+CloudFront, etc.) debe redirigir `/*` a `index.html` para que React Router maneje el routing.

## Alternativa descartada

Next.js permanece como opción válida si en el futuro se agrega un portal público (landing, documentación, onboarding) que requiera SEO. Para ese caso, se crearía una app separada (`apps/portal`) con Next.js — manteniendo el ERP interno como SPA pura.
