-- 0021_tablero.sql
-- Sesión 9 Capa 1: Tablero de Control + Valor Ganado
--
-- Única columna nueva: pagado en ejecucion_partida.
-- Curva S y trazabilidad se calculan desde tablas existentes en vivo.

ALTER TABLE ejecucion_partida
  ADD COLUMN IF NOT EXISTS pagado NUMERIC(18,4) NOT NULL DEFAULT 0;
