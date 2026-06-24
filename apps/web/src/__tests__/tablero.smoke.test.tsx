/**
 * Smoke tests del Tablero de Control.
 *
 * No levantan el API — mockean los tres hooks de datos para que el componente
 * renderice directamente con la respuesta simulada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { TablEroPage } from '@/pages/tablero';
import type { TableroProyecto } from '@/hooks/use-tablero';

// ── Recharts: stub para evitar errores de ResizeObserver en jsdom ─────────────
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}));

// ── Stubs de los tres hooks de datos ─────────────────────────────────────────
vi.mock('@/hooks/use-tablero', () => ({
  useTablero: vi.fn(),
  useCurvaS: vi.fn(),
  useTrazabilidad: vi.fn(),
}));

import {
  useTablero,
  useCurvaS,
  useTrazabilidad,
} from '@/hooks/use-tablero';

// ── Fixture ───────────────────────────────────────────────────────────────────
const TABLERO_OK: TableroProyecto = {
  proyectoId: 'proj-test-uuid',
  presupuestoVigente: '1000000.0000',
  comprometido:       '350000.0000',
  devengado:          '200000.0000',
  pagado:             '150000.0000',
  disponible:         '650000.0000',
  avancePct:          '20.0000',
  ev:                 '200000.0000',
  ac:                 '220000.0000',
  cpi:                '0.91',
  spi:                '0.85',
  alerta:             'AMARILLO',
  partidas:           [],
};

// ── Wrapper: Router con parámetro :id + QueryClient ───────────────────────────
function renderTablEro() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={['/proyectos/proj-test-uuid/tablero']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/proyectos/:id/tablero" element={<TablEroPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TablEroPage — smoke tests', () => {
  beforeEach(() => {
    // Curva S y trazabilidad siempre vacíos en estos tests
    vi.mocked(useCurvaS).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCurvaS>);

    vi.mocked(useTrazabilidad).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useTrazabilidad>);
  });

  it('renderiza las cuatro tarjetas KPI cuando el tablero tiene datos', () => {
    vi.mocked(useTablero).mockReturnValue({
      data: TABLERO_OK,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useTablero>);

    renderTablEro();

    // Las cuatro etiquetas de KPI deben aparecer (en mayúsculas via CSS, pero
    // el texto del DOM es el literal que renderiza el componente).
    expect(screen.getByText('Vigente')).toBeInTheDocument();
    expect(screen.getByText('Comprometido')).toBeInTheDocument();
    expect(screen.getByText('Devengado')).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
  });

  it('muestra el spinner de carga y no las tarjetas KPI mientras carga', () => {
    vi.mocked(useTablero).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useTablero>);

    renderTablEro();

    // El spinner (Loader2 de lucide-react) se renderiza dentro de LoadingSpinner.
    // LoadingSpinner NO tiene role="status"; verificamos por ausencia de KPIs.
    expect(screen.queryByText('Vigente')).not.toBeInTheDocument();
    expect(screen.queryByText('Comprometido')).not.toBeInTheDocument();
  });
});
