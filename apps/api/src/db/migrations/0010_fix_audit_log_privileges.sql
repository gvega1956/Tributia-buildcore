-- Migración 0010: corregir privilegios de audit_log
-- ─────────────────────────────────────────────────────────────────────────────
-- Problema: tools/db/init.sql hace ALTER DEFAULT PRIVILEGES ... GRANT SELECT,
-- INSERT, UPDATE, DELETE ON TABLES TO tributia_app, lo que le otorga INSERT,
-- UPDATE y DELETE sobre audit_log a pesar del GRANT SELECT explícito de 0002.
--
-- Corrección: revocar INSERT, UPDATE, DELETE de tributia_app en audit_log.
-- Solo el trigger audit_row() (SECURITY DEFINER como owner tributia) puede
-- escribir en esta tabla.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE INSERT, UPDATE, DELETE ON audit_log FROM tributia_app;
