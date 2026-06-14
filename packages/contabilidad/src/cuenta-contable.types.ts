export type TipoCuenta = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'costo' | 'gasto';
export type NaturalezaCuenta = 'deudora' | 'acreedora';

// ─── Plan de cuentas plantilla RD ────────────────────────────────────────────
// Nivel 1: grupo  (1 Activos, 2 Pasivos, 3 Patrimonio, 4 Ingresos, 5 Costos/Gastos)
// Nivel 2: subgrupo
// Nivel 3: cuenta de movimiento o agrupadora
// Nivel 4: subcuenta de movimiento
// Solo cuentas con es_movimiento=true admiten líneas de asiento.
