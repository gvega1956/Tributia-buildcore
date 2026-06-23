import { useState } from 'react';
import { BookMarked, ChevronRight } from 'lucide-react';
import { useLibroMayor } from '@/hooks/use-contabilidad';
import { Input } from '@/components/ui/input';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import Decimal from 'decimal.js';

const HOY = new Date().toISOString().slice(0, 10);
const PRIMER_DIA_MES = HOY.slice(0, 7) + '-01';

export function LibroMayorPage() {
  const [cuentaId, setCuentaId] = useState('');
  const [cuentaInput, setCuentaInput] = useState('');
  const [fechaDesde, setFechaDesde] = useState(PRIMER_DIA_MES);
  const [fechaHasta, setFechaHasta] = useState(HOY);
  const [asientoId, setAsientoId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useLibroMayor(cuentaId, { fechaDesde, fechaHasta });

  function handleBuscar() {
    setCuentaId(cuentaInput.trim());
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BookMarked size={18} className="text-brand-500" />
        <h1 className="text-xl font-bold text-gray-900">Libro Mayor</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <label className="text-sm font-medium text-gray-600 shrink-0">Cuenta ID:</label>
        <Input
          value={cuentaInput}
          onChange={(e) => setCuentaInput(e.target.value)}
          placeholder="UUID de la cuenta contable"
          className="w-80"
          onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
        />
        <label className="text-sm font-medium text-gray-600 shrink-0">Desde:</label>
        <Input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="w-36" />
        <label className="text-sm font-medium text-gray-600 shrink-0">Hasta:</label>
        <Input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="w-36" />
        <button
          onClick={handleBuscar}
          className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition-colors"
        >
          Consultar
        </button>
      </div>

      {!cuentaId && (
        <EmptyState title="Selecciona una cuenta" description="Ingresa el ID de la cuenta contable que deseas consultar." />
      )}

      {cuentaId && isLoading && <LoadingSpinner />}
      {cuentaId && error && <ErrorState message="Error cargando Libro Mayor" onRetry={() => refetch()} />}

      {data && (
        <div className="space-y-4">
          {/* Header cuenta */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
            <div>
              <p className="font-mono text-sm text-gray-500">{data.cuentaCodigo}</p>
              <p className="text-lg font-bold text-gray-900">{data.cuentaNombre}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Saldo inicial</p>
              <p className="text-base font-semibold tabular-nums">{new Decimal(data.saldoInicial).toFixed(2)}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-6 py-3 font-medium">Fecha</th>
                  <th className="text-left px-4 py-3 font-medium">Descripción</th>
                  <th className="text-right px-6 py-3 font-medium">Debe</th>
                  <th className="text-right px-6 py-3 font-medium">Haber</th>
                  <th className="text-right px-6 py-3 font-medium">Saldo</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {data.lineas.map((l) => (
                  <tr
                    key={`${l.asientoId}-${l.fecha}`}
                    className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setAsientoId(l.asientoId)}
                  >
                    <td className="px-6 py-2.5">{l.fecha}</td>
                    <td className="px-4 py-2.5 text-gray-700">{l.descripcion}</td>
                    <td className="px-6 py-2.5 text-right tabular-nums">
                      {l.debe ? new Decimal(l.debe).toFixed(2) : ''}
                    </td>
                    <td className="px-6 py-2.5 text-right tabular-nums">
                      {l.haber ? new Decimal(l.haber).toFixed(2) : ''}
                    </td>
                    <td className="px-6 py-2.5 text-right tabular-nums font-semibold">
                      {new Decimal(l.saldo).toFixed(2)}
                    </td>
                    {/* Trazabilidad navegable: clic abre el asiento */}
                    <td className="px-4 py-2.5">
                      <ChevronRight size={14} className="text-gray-300" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                  <td colSpan={4} className="px-6 py-3 text-sm text-right">Saldo final</td>
                  <td className="px-6 py-3 text-right tabular-nums text-base">
                    {new Decimal(data.saldoFinal).toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {data.lineas.length === 0 && (
            <EmptyState title="Sin movimientos" description="No hay movimientos en esta cuenta para el período seleccionado." />
          )}
        </div>
      )}

      {/* Nota: clic en fila abre el asiento — trazabilidad del saldo al asiento */}
      {asientoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-brand-600 text-sm font-semibold">
                <ChevronRight size={14} />
                Trazabilidad → Asiento
              </div>
              <button onClick={() => setAsientoId(null)} className="text-gray-400 hover:text-gray-700 text-lg">×</button>
            </div>
            <p className="text-xs font-mono text-gray-500 mb-4">{asientoId}</p>
            <p className="text-sm text-gray-600">Navega al Libro Diario con este ID para ver el asiento completo y su evento origen.</p>
          </div>
        </div>
      )}
    </div>
  );
}
