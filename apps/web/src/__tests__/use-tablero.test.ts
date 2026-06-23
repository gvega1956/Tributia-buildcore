/**
 * Prueba de contrato del hook useTablero.
 *
 * Verifica el invariante clave: cuando proyectoId es una cadena vacía
 * el hook no debe iniciar ninguna petición al API (enabled: false).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { useTablero } from '@/hooks/use-tablero';

// Mockear el cliente del API para asegurarnos de que no se hacen peticiones reales
vi.mock('@/lib/api', () => ({
  getApiClient: () => ({
    GET: vi.fn().mockRejectedValue(new Error('No debe llamarse con proyectoId vacío')),
  }),
}));

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe('useTablero', () => {
  it('no ejecuta la query cuando proyectoId está vacío', () => {
    const { result } = renderHook(() => useTablero(''), {
      wrapper: makeWrapper(),
    });

    // Con enabled: false la query queda en estado pendiente pero NUNCA fetching.
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});
