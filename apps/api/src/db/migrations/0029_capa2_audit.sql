-- Sesión 8 Capa 2 — Auditoría de cierre
--
-- Defecto A: migración 0028_flujo_caja.sql no incluyó el GRANT de tributia_app
-- sobre cubicacion_proyectada. Sin este GRANT, la tabla era inaccesible para
-- el rol de aplicación en cualquier entorno que no use el rol admin directamente.
-- El defecto no se manifestó en tests porque todos usaban adminDb (tributia role).
--
-- Este GRANT sigue el mismo patrón que todas las demás tablas de negocio:
-- SELECT, INSERT, UPDATE, DELETE para tributia_app (rol de aplicación, sujeto a RLS).
-- DELETE está incluido por consistencia con el patrón; el soft-delete via
-- deleted_at/deleted_by es el mecanismo operacional (P8).

GRANT SELECT, INSERT, UPDATE, DELETE ON cubicacion_proyectada TO tributia_app;
