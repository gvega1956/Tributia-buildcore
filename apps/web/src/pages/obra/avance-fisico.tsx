import { useState } from 'react';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import { usePartesDiarios } from '@/hooks/use-obra';
import { useProyectos } from '@/hooks/use-proyectos';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import Decimal from 'decimal.js';

type ResumenPartida = {
  partidaId: string;
  unidad: string;
  cantidadTotal: Decimal;
  apariciones: number;
};

export function AvanceFisicoPage() {
  const [proyectoFiltro, setProyectoFiltro] = useState('');
  const { data: proyectos = [] } = useProyectos();
  const { data: partes = [], isLoading, error, refetch } = usePartesDiarios(proyectoFiltro || undefined);

  // Acumular avances por partida (cantidadEjecutada, nunca porcentaje)
  const resumenPorPartida = partes
    .filter((p) => p.confirmado)
    .flatMap((p) => p.avances)
    .reduce<Record<string, ResumenPartida>>((acc, avance) => {
      const key = avance.partidaId;
      if (!acc[key]) {
        acc[key] = { partidaId: key, unidad: avance.unidad, cantidadTotal: new Decimal(0), apariciones: 0 };
      }
      acc[key].cantidadTotal = acc[key].cantidadTotal.plus(new Decimal(avance.cantidadEjecutada));
      acc[key].apariciones += 1;
      return acc;
    }, {});

  const resumen = Object.values(resumenPorPartida);
  const partesNoConfirmados = partes.filter((p) => !p.confirmado);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Avance Físico</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cantidad ejecutada acumulada por partida — basada en partes diarios confirmados
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-600 shrink-0">Proyecto:</label>
        <select
          value={proyectoFiltro}
          onChange={(e) => setProyectoFiltro(e.target.value)}
          className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[200px]"
        >
          <option value="">Todos</option>
          {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      {partesNoConfirmados.length > 0 && (
        <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800">
            Hay {partesNoConfirmados.length} parte(s) en borrador que no se incluyen en el avance. Confírmalos para que cuenten.
          </p>
        </div>
      )}

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando avances" onRetry={() => refetch()} />}

      {!isLoading && !error && (
        resumen.length === 0
          ? (
            <EmptyState
              title="Sin avances registrados"
              description="Los avances aparecen aquí una vez que se confirman los partes diarios con cantidades ejecutadas por partida."
            />
          )
          : (
            <div className="space-y-4">
              {/* KPIs */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Partidas con avance</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{resumen.length}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Partes confirmados</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                    {partes.filter((p) => p.confirmado).length}
                  </p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Registros de avance</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
                    {resumen.reduce((s, r) => s + r.apariciones, 0)}
                  </p>
                </div>
              </div>

              {/* Tabla de avance por partida */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                  <TrendingUp size={16} className="text-brand-500" />
                  <h2 className="text-sm font-semibold text-gray-800">Cantidad ejecutada por partida</h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-6 py-3 font-medium">Partida ID</th>
                      <th className="text-right px-6 py-3 font-medium">Cantidad ejecutada</th>
                      <th className="text-left px-4 py-3 font-medium">Unidad</th>
                      <th className="text-right px-6 py-3 font-medium">Apariciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.map((row) => (
                      <tr key={row.partidaId} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-6 py-3 font-mono text-xs text-gray-500">{row.partidaId.slice(0, 16)}…</td>
                        {/* avance por CANTIDAD acumulada, sin porcentaje */}
                        <td className="px-6 py-3 text-right font-semibold tabular-nums text-gray-900">
                          {row.cantidadTotal.toDecimalPlaces(4).toFixed(4)}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{row.unidad}</td>
                        <td className="px-6 py-3 text-right tabular-nums text-gray-500">{row.apariciones}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
      )}
    </div>
  );
}
