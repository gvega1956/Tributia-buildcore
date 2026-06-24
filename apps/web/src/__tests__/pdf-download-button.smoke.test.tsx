/**
 * Smoke test — Botón "Descargar PDF" en la página de Órdenes de Compra.
 *
 * Verifica que:
 *  1. El botón PDF se renderiza en cada fila de la tabla.
 *  2. Al hacer clic llama al hook useDescargarOrdenCompraPdf.descargar(id).
 *  3. El botón se deshabilita mientras isPending = true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrdenesCompraPage } from '@/pages/compras/ordenes-compra';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/use-compras', () => ({
  useOrdenesCompra:      vi.fn(),
  useCreateOrdenCompra:  vi.fn(),
  useAprobarOrdenCompra: vi.fn(),
  useEmitirOrdenCompra:  vi.fn(),
}));

vi.mock('@/hooks/use-documentos-pdf', () => ({
  useDescargarOrdenCompraPdf:   vi.fn(),
  useDescargarCubicacionPdf:    vi.fn(),
  useDescargarFacturaClientePdf: vi.fn(),
}));

import {
  useOrdenesCompra,
  useCreateOrdenCompra,
  useAprobarOrdenCompra,
  useEmitirOrdenCompra,
} from '@/hooks/use-compras';
import { useDescargarOrdenCompraPdf } from '@/hooks/use-documentos-pdf';

// ── Fixture ───────────────────────────────────────────────────────────────────

const OC_FIXTURE = {
  id:                   'oc-uuid-0001',
  terceroId:            'prov-uuid-0001',
  estado:               'EMITIDA' as const,
  fechaEntregaPrometida: '2026-07-15',
  createdAt:            '2026-06-20T10:00:00Z',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={['/compras/ordenes-compra']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <OrdenesCompraPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockIdleMutations() {
  const mut = { mutateAsync: vi.fn(), isPending: false } as never;
  vi.mocked(useCreateOrdenCompra).mockReturnValue(mut);
  vi.mocked(useAprobarOrdenCompra).mockReturnValue(mut);
  vi.mocked(useEmitirOrdenCompra).mockReturnValue(mut);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OrdenesCompraPage — botón Descargar PDF (smoke)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renderiza el botón PDF cuando hay órdenes de compra', () => {
    vi.mocked(useOrdenesCompra).mockReturnValue({
      data: [OC_FIXTURE], isLoading: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useOrdenesCompra>);
    mockIdleMutations();
    vi.mocked(useDescargarOrdenCompraPdf).mockReturnValue({
      descargar: vi.fn(), isPending: false, error: null,
    });

    renderPage();

    expect(screen.getByRole('button', { name: /descargar pdf/i })).toBeInTheDocument();
  });

  it('llama a descargar(id) al hacer clic en el botón PDF', () => {
    const descargarMock = vi.fn();
    vi.mocked(useOrdenesCompra).mockReturnValue({
      data: [OC_FIXTURE], isLoading: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useOrdenesCompra>);
    mockIdleMutations();
    vi.mocked(useDescargarOrdenCompraPdf).mockReturnValue({
      descargar: descargarMock, isPending: false, error: null,
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /descargar pdf/i }));

    expect(descargarMock).toHaveBeenCalledOnce();
    expect(descargarMock).toHaveBeenCalledWith(OC_FIXTURE.id);
  });

  it('el botón está deshabilitado mientras isPending = true', () => {
    vi.mocked(useOrdenesCompra).mockReturnValue({
      data: [OC_FIXTURE], isLoading: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useOrdenesCompra>);
    mockIdleMutations();
    vi.mocked(useDescargarOrdenCompraPdf).mockReturnValue({
      descargar: vi.fn(), isPending: true, error: null,
    });

    renderPage();

    expect(screen.getByRole('button', { name: /descargar pdf/i })).toBeDisabled();
  });
});
