import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import { getApiClient } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardValue, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState } from '@/components/ui/states';

interface TableroPartidaRow {
  partidaId: string;
  codigo: string;
  nombre: string;
  nivel: number;
  presupuestoVigente: string;
  comprometido: string;
  devengado: string;
  pagado: string;
  disponible: string;
  cantidadPresupuestada: string | null;
  cantidadEjecutada: string | null;
  avancePct: string;
  ev: string;
  ac: string;
  cpi: string | null;
  spi: string | null;
}

interface TableroProyecto {
  proyectoId: string;
  presupuestoVigente: string;
  comprometido: string;
  devengado: string;
  pagado: string;
  disponible: string;
  avancePct: string;
  ev: string;
  ac: string;
  cpi: string | null;
  spi: string | null;
  alerta: 'VERDE' | 'AMARILLO' | 'ROJO';
  partidas: TableroPartidaRow[];
}

function fmt(val: string | null | undefined, decimals = 2) {
  if (val == null) return '—';
  return new Intl.NumberFormat('es-DO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(parseFloat(val));
}

function fmtMoney(val: string | null | undefined) {
  if (val == null) return '—';
  return `$${new Intl.NumberFormat('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(parseFloat(val))}`;
}

function cpiVariant(cpi: string | null): 'success' | 'warning' | 'danger' {
  if (cpi == null) return 'warning';
  const v = parseFloat(cpi);
  if (v >= 0.95) return 'success';
  if (v >= 0.80) return 'warning';
  return 'danger';
}

function AlertaIcon({ alerta }: { alerta: string }) {
  if (alerta === 'VERDE')    return <CheckCircle  size={18} className="text-green-500" />;
  if (alerta === 'AMARILLO') return <AlertCircle  size={18} className="text-amber-500" />;
  return                            <AlertTriangle size={18} className="text-red-500" />;
}

function useTablero(id: string) {
  return useQuery({
    queryKey: ['tablero', id],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/tablero/proyecto/{id}', {
        params: { path: { id } },
      });
      if (error) throw new Error('Error cargando tablero');
      return data as TableroProyecto;
    },
    enabled: !!id,
  });
}

export function TablEroPage() {
  const { id = '' } = useParams();
  const { data: tablero, isLoading, error, refetch } = useTablero(id);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <Link
        to="/proyectos"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6"
      >
        <ChevronLeft size={16} />
        Proyectos
      </Link>

      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Tablero de Control</h1>
        {tablero && (
          <div className="flex items-center gap-2">
            <AlertaIcon alerta={tablero.alerta} />
            <span className="text-sm font-medium text-gray-600">
              {tablero.alerta === 'VERDE'
                ? 'En control'
                : tablero.alerta === 'AMARILLO'
                ? 'Atención requerida'
                : 'Alerta crítica'}
            </span>
          </div>
        )}
      </div>

      {error && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Error cargando tablero'}
          onRetry={() => refetch()}
        />
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : tablero ? (
        <>
          {/* Tríada */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Card>
              <CardHeader><CardTitle>Presupuesto vigente</CardTitle></CardHeader>
              <CardValue className="text-2xl">{fmtMoney(tablero.presupuestoVigente)}</CardValue>
            </Card>
            <Card>
              <CardHeader><CardTitle>Comprometido</CardTitle></CardHeader>
              <CardValue className="text-2xl text-amber-600">{fmtMoney(tablero.comprometido)}</CardValue>
            </Card>
            <Card>
              <CardHeader><CardTitle>Devengado</CardTitle></CardHeader>
              <CardValue className="text-2xl text-blue-600">{fmtMoney(tablero.devengado)}</CardValue>
            </Card>
            <Card>
              <CardHeader><CardTitle>Disponible</CardTitle></CardHeader>
              <CardValue className={`text-2xl ${parseFloat(tablero.disponible) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {fmtMoney(tablero.disponible)}
              </CardValue>
            </Card>
          </div>

          {/* EVM */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Card>
              <CardHeader><CardTitle>Avance físico</CardTitle></CardHeader>
              <CardValue className="text-2xl">{fmt(tablero.avancePct)}%</CardValue>
            </Card>
            <Card>
              <CardHeader><CardTitle>Valor ganado (EV)</CardTitle></CardHeader>
              <CardValue className="text-2xl">{fmtMoney(tablero.ev)}</CardValue>
            </Card>
            <Card>
              <CardHeader><CardTitle>Costo real (AC)</CardTitle></CardHeader>
              <CardValue className="text-2xl">{fmtMoney(tablero.ac)}</CardValue>
            </Card>
            <Card>
              <CardHeader><CardTitle>CPI / SPI</CardTitle></CardHeader>
              <CardContent className="pt-2">
                <div className="flex gap-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">CPI</p>
                    <Badge variant={cpiVariant(tablero.cpi)}>{tablero.cpi ? fmt(tablero.cpi) : '—'}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">SPI</p>
                    <Badge variant={cpiVariant(tablero.spi)}>{tablero.spi ? fmt(tablero.spi) : '—'}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabla partidas */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Tríada por partida</h2>
              <p className="text-xs text-gray-400 mt-0.5">{tablero.partidas.length} partidas</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Partida</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vigente</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Comprometido</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Devengado</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Disponible</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Avance</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">CPI</th>
                  </tr>
                </thead>
                <tbody>
                  {tablero.partidas.map((p) => (
                    <tr key={p.partidaId} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3">
                        <p className="font-mono text-xs text-gray-400">{p.codigo}</p>
                        <p className="font-medium text-gray-900">{p.nombre}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{fmtMoney(p.presupuestoVigente)}</td>
                      <td className="px-4 py-3 text-right text-amber-600 tabular-nums">{fmtMoney(p.comprometido)}</td>
                      <td className="px-4 py-3 text-right text-blue-600 tabular-nums">{fmtMoney(p.devengado)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${parseFloat(p.disponible) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {fmtMoney(p.disponible)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(p.avancePct)}%</td>
                      <td className="px-4 py-3 text-right">
                        {p.cpi
                          ? <Badge variant={cpiVariant(p.cpi)} className="text-xs">{fmt(p.cpi)}</Badge>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
