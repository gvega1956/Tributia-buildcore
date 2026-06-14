import { describe, it, expect } from 'vitest';
import { zLoginInput, zRefreshInput } from '../usuario.schema.js';

describe('zLoginInput', () => {
  const valid = { tenantSlug: 'demo', email: 'user@example.com', password: 'Pass!1234' };

  it('acepta input válido', () => {
    expect(() => zLoginInput.parse(valid)).not.toThrow();
  });

  it('rechaza slug con mayúsculas', () => {
    expect(() => zLoginInput.parse({ ...valid, tenantSlug: 'Demo' })).toThrow();
  });

  it('rechaza slug con espacios', () => {
    expect(() => zLoginInput.parse({ ...valid, tenantSlug: 'mi empresa' })).toThrow();
  });

  it('rechaza email inválido', () => {
    expect(() => zLoginInput.parse({ ...valid, email: 'not-an-email' })).toThrow();
  });

  it('rechaza contraseña menor a 8 caracteres', () => {
    expect(() => zLoginInput.parse({ ...valid, password: 'short' })).toThrow();
  });

  it('rechaza contraseña mayor a 128 caracteres', () => {
    expect(() => zLoginInput.parse({ ...valid, password: 'A'.repeat(129) })).toThrow();
  });
});

describe('zRefreshInput', () => {
  it('acepta UUID válido como refresh token', () => {
    expect(() =>
      zRefreshInput.parse({ refreshToken: '019046f2-1234-7abc-bdef-000000000000' }),
    ).not.toThrow();
  });

  it('rechaza string que no es UUID', () => {
    expect(() => zRefreshInput.parse({ refreshToken: 'not-a-uuid' })).toThrow();
  });
});
