import { useState } from 'react';
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import { useBalanceGeneral, useEstadoResultados } from '@/hooks/use-contabilidad';
import { useProyectos } from '@/hooks/use-proyectos';
import { Input } from '@/components/ui/input';
import { LoadingSpinner, ErrorState } from '@/components/ui/states';
import Decimal from 'decimal.js';

const HOY = new Date().toISOString().slice(0, 10);
const PRIMER_DIA_MES = HOY.slice(0, 7) + '-01';

function ImporteRow({ label, importe, indent = 0, bold = false }: {
  label: string; importe: string; indent?: number; bold?: boolean;
}) {
  const val = new Decimal(importe);
  return (
    <div className={`flex justify-between py-1.5 ${indent > 0 ? `pl-${indent * 4}` : ''}`}>
      <span className={`text-sm ${bold ? 'font-bold text-gray-900' : 'text-gray-700'}`}>{label}</span>
      <span className={`text-sm tabular-nums ${bold ? 'font-bold text-gray-900' : val.lt(0) ? 'text-red-600' : 'text-gray-900'}`}>
        {val.toFixed(2)}
      </span>
    </div>
  );
}

function Seccion({ titulo, partidas, subtotal }: { titulo: string; partidas: {descripcion: string; importe: string}[]; subtotal: string }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{titulo}</p>
      {partidas.map((p, i) => (
        <div key={i} className="flex justify-between py-1 pl-4">
          <span className="text-sm text-gray-700">{p.descripcion}</span>
          <span className="text-sm tabular-nums text-gray-900">{new Decimal(p.importe).toFixed(2)}</span>
        </div>
      ))}
      <div className="flex justify-between py-1.5 border-t border-gray-200 mt-1 font-semibold">
        <span className="text-sm text-gray-800">Total {titulo}</span>
        <span className="text-sm tabular-nums">{new Decimal(subtotal).toFixed(2)}</span>
      </div>
    </div>
  );
}

export function EstadosFinancierosPage() {
  const [tab, setTab] = useState<'balance' | 'resultados'>('balance');
  const [fechaCorte, setFechaCorte] = useState(HOY);
  const [fechaDesde, setFechaDesde] = useState(PRIMER_DIA_MES);
  const [fechaHasta, setFechaHasta] = useState(HOY);
  const [proyectoFiltro, setProyectoFiltro] = useState('');

  const { data: proyectos = [] } = useProyectos();
  const balanceQ = useBalanceGeneral(fechaCorte);
  const resultadosQ = useEstadoResultados({
    fechaDesde, fechaHasta,
    ...(proyectoFiltro ? { proyectoId: proyectoFiltro } : {}),
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 size={18} className="text-brand-500" />
        <h1 className="text-xl font-bold text-gray-900">Estados Financieros</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab('balance')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'balance' ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:text-gray-900'}`}
        >
          Balance General
        </button>
        <button
          onClick={() => setTab('resultados')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'resultados' ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:text-gray-900'}`}
        >
          Estado de Resultados
        </button>
      </div>

      {/* Balance General */}
      {tab === 'balance' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-600 shrink-0">Corte al:</label>
            <Input type="date" value={fechaCorte} onChange={(e) => setFechaCorte(e.target.value)} className="w-36" />
          </div>

          {balanceQ.isLoading && <LoadingSpinner />}
          {balanceQ.error && <ErrorState message="Error cargando Balance General" onRetry={() => balanceQ.refetch()} />}

          {balanceQ.data && (
            <div className="grid grid-cols-2 gap-6">
              {/* Activo */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp size={16} className="text-green-500" />
                  <h2 className="font-bold text-gray-900">Activo</h2>
                </div>
                {balanceQ.data.activo.map((s, i) => <Seccion key={i} {...s} />)}
                <div className="border-t-2 border-gray-900 pt-2 mt-2 flex justify-between font-bold text-base">
                  <span>Total Activo</span>
                  <span className="tabular-nums">{new Decimal(balanceQ.data.totalActivo).toFixed(2)}</span>
                </div>
              </div>

              {/* Pasivo + Patrimonio */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingDown size={16} className="text-red-500" />
                  <h2 className="font-bold text-gray-900">Pasivo + Patrimonio</h2>
                </div>
                {balanceQ.data.pasivo.map((s, i) => <Seccion key={i} {...s} />)}
                {balanceQ.data.patrimonio.map((s, i) => <Seccion key={i} {...s} />)}
                <div className="border-t-2 border-gray-900 pt-2 mt-2 flex justify-between font-bold text-base">
                  <span>Total Pasivo + Patrimonio</span>
                  <span className="tabular-nums">{new Decimal(balanceQ.data.totalPasivoPatrimonio).toFixed(2)}</span>
                </div>
              </div>

              {/* Verificación cuadre — si no cuadra lo mostramos */}
              {!balanceQ.data.cuadra && (
                <div className="col-span-2 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 font-semibold">
                  ⚠ Balance NO cuadra: Activo ({new Decimal(balanceQ.data.totalActivo).toFixed(2)}) ≠ Pasivo+Patrimonio ({new Decimal(balanceQ.data.totalPasivoPatrimonio).toFixed(2)})
                </div>
              )}
              {balanceQ.data.cuadra && (
                <div className="col-span-2 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 font-medium">
                  ✓ Activo = Pasivo + Patrimonio = {new Decimal(balanceQ.data.totalActivo).toFixed(2)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Estado de Resultados */}
      {tab === 'resultados' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-gray-600 shrink-0">Desde:</label>
            <Input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="w-36" />
            <label className="text-sm font-medium text-gray-600 shrink-0">Hasta:</label>
            <Input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="w-36" />
            <label className="text-sm font-medium text-gray-600 shrink-0">Proyecto:</label>
            <select
              value={proyectoFiltro}
              onChange={(e) => setProyectoFiltro(e.target.value)}
              className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Consolidado</option>
              {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>

          {resultadosQ.isLoading && <LoadingSpinner />}
          {resultadosQ.error && <ErrorState message="Error cargando Estado de Resultados" onRetry={() => resultadosQ.refetch()} />}

          {resultadosQ.data && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-xl">
              {resultadosQ.data.ingresos.map((s, i) => <Seccion key={i} {...s} />)}
              <ImporteRow label="Utilidad Bruta" importe={resultadosQ.data.utilidadBruta} bold />
              <div className="my-3 border-t border-gray-100" />
              {resultadosQ.data.costos.map((s, i) => <Seccion key={i} {...s} />)}
              {resultadosQ.data.gastos.map((s, i) => <Seccion key={i} {...s} />)}
              <div className="border-t border-gray-100 my-2" />
              <ImporteRow label="Utilidad Operativa" importe={resultadosQ.data.utilidadOperativa} bold />
              <div className="mt-4 border-t-2 border-gray-900 pt-3">
                <ImporteRow label="UTILIDAD NETA" importe={resultadosQ.data.utilidadNeta} bold />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
