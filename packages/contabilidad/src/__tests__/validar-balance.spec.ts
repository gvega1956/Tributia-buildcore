import { describe, it, expect } from 'vitest';
import { validarBalance } from '../asiento.types.js';
import type { LineaAsientoInput } from '../asiento.types.js';

describe('validarBalance — función pura P4', () => {
  it('devuelve true cuando debe = haber exactos', () => {
    const lineas: LineaAsientoInput[] = [
      { cuentaCodigo: '5101', tipo: 'debe',  importe: '1000.0000', moneda: 'DOP' },
      { cuentaCodigo: '1104', tipo: 'haber', importe: '1000.0000', moneda: 'DOP' },
    ];
    expect(validarBalance(lineas)).toBe(true);
  });

  it('devuelve true con múltiples líneas que balancean', () => {
    const lineas: LineaAsientoInput[] = [
      { cuentaCodigo: '5101', tipo: 'debe',  importe:  '750.0000', moneda: 'DOP' },
      { cuentaCodigo: '5102', tipo: 'debe',  importe:  '250.0000', moneda: 'DOP' },
      { cuentaCodigo: '1104', tipo: 'haber', importe: '1000.0000', moneda: 'DOP' },
    ];
    expect(validarBalance(lineas)).toBe(true);
  });

  it('devuelve false cuando debe ≠ haber', () => {
    const lineas: LineaAsientoInput[] = [
      { cuentaCodigo: '5101', tipo: 'debe',  importe: '500.0000', moneda: 'DOP' },
      { cuentaCodigo: '1104', tipo: 'haber', importe: '400.0000', moneda: 'DOP' },
    ];
    expect(validarBalance(lineas)).toBe(false);
  });

  it('devuelve false cuando solo hay líneas de debe', () => {
    const lineas: LineaAsientoInput[] = [
      { cuentaCodigo: '5101', tipo: 'debe', importe: '100.0000', moneda: 'DOP' },
    ];
    expect(validarBalance(lineas)).toBe(false);
  });

  it('maneja decimales de 4 posiciones sin error de punto flotante', () => {
    // 3 * 0.0001 = 0.0003 — con float nativo podría dar 0.00030000000000000003
    const lineas: LineaAsientoInput[] = [
      { cuentaCodigo: '5101', tipo: 'debe',  importe: '0.0001', moneda: 'DOP' },
      { cuentaCodigo: '5101', tipo: 'debe',  importe: '0.0001', moneda: 'DOP' },
      { cuentaCodigo: '5101', tipo: 'debe',  importe: '0.0001', moneda: 'DOP' },
      { cuentaCodigo: '1104', tipo: 'haber', importe: '0.0003', moneda: 'DOP' },
    ];
    expect(validarBalance(lineas)).toBe(true);
  });

  it('devuelve true con lista vacía (sin líneas no hay desbalance)', () => {
    expect(validarBalance([])).toBe(true);
  });
});
