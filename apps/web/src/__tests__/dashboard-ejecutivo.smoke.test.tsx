/**
 * Smoke tests del Dashboard Ejecutivo.
 *
 * Mockean los tres hooks de datos para no levantar el API.
 * Verifican que las tres secciones (KPI cards, health grid, actividad)
 * rendericen correctamente con datos y que el estado de carga sea correcto.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DashboardEjecutivoPage } from '@/pages/dashboard-ejecutivo';
import type {
  KPIsCartera,
  SaludProyecto,
  ActividadItem,
} from '@/hooks/use-dashboard-ejecutivo';

// ── Mocks de los tres hooks de datos ─────────────────────────────────────────
vi.mock('@/hooks/use-dashboard-ejecutivo', () => ({
  useKPIsCartera:     vi.fn(),
  useSaludProyectos:  vi.fn(),
  useFeedActividad:   vi.fn(),
}));

import {
  useKPIsCartera,
  useSaludProyectos,
  useFeedActividad,
} from '@/hooks/use-dashboard-ejecutivo';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const KPIS_OK: KPIsCartera = {
  totalProyectosActivos: 5,
  montoTotalCartera:     '12500000.0000',
  monedaBase:            'DOP',
  cpiPromedioPonderado:  '0.94',
  spiPromedioPonderado:  '0.88',
  proyectosEnRojo:       1,
  proyectosEnAmarillo:   2,
  proyectosEnVerde:      2,
};

const SALUD_OK: SaludProyecto[] = [
  {
    proyectoId:        'proj-1',
    codigo:            'P-001',
    nombre:            'Edificio Piantini',
    alerta:            'VERDE',
    cpi:               '1.02',
    spi:               '0.98',
    avancePct:         '45.0000',
    presupuestoVigente:'5000000.0000',
    monedaContrato:    'DOP',
  },
  {
    proyectoId:        'proj-2',
    codigo:            'P-002',
    nombre:            'Carretera Sur',
    alerta:            'ROJO',
    cpi:               '0.78',
    spi:               '0.70',
    avancePct:         '30.0000',
    presupuestoVigente:'7500000.0000',
    monedaContrato:    'DOP',
  },
];

const ACTIVIDAD_OK: ActividadItem[] = [
  {
    eventoId:       'evt-1',
    tipoEvento:     'recepcion_oc',
    proyectoNombre: 'Edificio Piantini',
    ocurridoEn:     '2026-06-20T10:30:00Z',
  },
  {
    eventoId:       'evt-2',
    tipoEvento:     'parte_diario',
    proyectoNombre: 'Carretera Sur',
    ocurridoEn:     '2026-06-21T08:00:00Z',
  },
];

// ── Wrapper ───────────────────────────────────────────────────────────────────

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={['/dashboard']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <DashboardEjecutivoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Helpers de mock ───────────────────────────────────────────────────────────

function mockAllLoaded() {
  vi.mocked(useKPIsCartera).mockReturnValue({
    data: KPIS_OK, isLoading: false, error: null, refetch: vi.fn(),
  } as ReturnType<typeof useKPIsCartera>);

  vi.mocked(useSaludProyectos).mockReturnValue({
    data: SALUD_OK, isLoading: false, error: null, refetch: vi.fn(),
  } as ReturnType<typeof useSaludProyectos>);

  vi.mocked(useFeedActividad).mockReturnValue({
    data: ACTIVIDAD_OK, isLoading: false, error: null, refetch: vi.fn(),
  } as ReturnType<typeof useFeedActividad>);
}

function mockAllLoading() {
  const stub = { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
  vi.mocked(useKPIsCartera).mockReturnValue(stub    as ReturnType<typeof useKPIsCartera>);
  vi.mocked(useSaludProyectos).mockReturnValue(stub as ReturnType<typeof useSaludProyectos>);
  vi.mocked(useFeedActividad).mockReturnValue(stub  as ReturnType<typeof useFeedActividad>);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DashboardEjecutivoPage — smoke tests', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renderiza las cuatro tarjetas KPI de cartera cuando hay datos', () => {
    mockAllLoaded();
    renderDashboard();

    expect(screen.getByText('Proyectos Activos')).toBeInTheDocument();
    expect(screen.getByText('Cartera Total')).toBeInTheDocument();
    expect(screen.getByText('En Alerta')).toBeInTheDocument();
    expect(screen.getByText('CPI Promedio')).toBeInTheDocument();
  });

  it('renderiza el grid de salud con los nombres de los proyectos', () => {
    mockAllLoaded();
    renderDashboard();

    const section = screen.getByRole('region', { name: /salud de proyectos/i });
    expect(within(section).getByText('Edificio Piantini')).toBeInTheDocument();
    expect(within(section).getByText('Carretera Sur')).toBeInTheDocument();
  });

  it('renderiza el feed de actividad con los tipos de evento localizados', () => {
    mockAllLoaded();
    renderDashboard();

    const section = screen.getByRole('region', { name: /actividad reciente/i });
    // Los ítems de la actividad muestran el label localizado del tipo de evento
    expect(within(section).getByText('Recepción OC')).toBeInTheDocument();
    expect(within(section).getByText('Parte Diario')).toBeInTheDocument();
  });

  it('no muestra las tarjetas KPI mientras está cargando', () => {
    mockAllLoading();
    renderDashboard();

    // La página sigue mostrando el heading
    expect(screen.getByRole('heading', { name: /dashboard ejecutivo/i })).toBeInTheDocument();

    // Pero las etiquetas de KPI no aparecen (LoadingSpinner ocupa su lugar)
    expect(screen.queryByText('Proyectos Activos')).not.toBeInTheDocument();
    expect(screen.queryByText('Cartera Total')).not.toBeInTheDocument();
  });
});
