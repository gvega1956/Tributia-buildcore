-- Tributia BuildCore — inicialización de base de datos
-- Se ejecuta UNA SOLA VEZ al crear el contenedor PostgreSQL.
-- Las migraciones del schema van en apps/api/src/db/migrations/.

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- Función helper para RLS
-- Devuelve el tenant_id del request actual (SET LOCAL app.tenant_id = '...')
-- Si no está seteado, devuelve NULL → la política RLS rechaza todas las filas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rol de aplicación (sujeto a RLS)
-- Las migraciones corren como 'tributia' (dueño de tablas → bypassa RLS).
-- El runtime de la API corre como 'tributia_app' (sujeto a RLS).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tributia_app') THEN
    CREATE ROLE tributia_app WITH LOGIN PASSWORD 'tributia_app_dev' NOINHERIT;
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO tributia_app;

-- Privilegios default para tablas y secuencias creadas por 'tributia' en el futuro
ALTER DEFAULT PRIVILEGES FOR ROLE tributia IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tributia_app;

ALTER DEFAULT PRIVILEGES FOR ROLE tributia IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tributia_app;
