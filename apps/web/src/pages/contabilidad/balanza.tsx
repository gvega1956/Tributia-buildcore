import { useState } from 'react';
import { Scale } from 'lucide-react';
import { useBalanza } from '@/hooks/use-contabilidad';
import { Input } from '@/components/ui/input';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import Decimal from 'decimal.js';

const HOY = new Date().toISOString().slice(0, 10);
const PRIMER_DIA_MES = HOY.slice(0, 7) + '-01';

export function BalanzaPage() {
  const [fechaDesde, setFechaDesde] = useState(PRIMER_DIA_MES);
  const [fechaHasta, setFechaHasta] = useState(HOY);

  const { data, isLoading, error, refetch } = useBalanza({ fechaDesde, fechaHasta });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Scale size={18} className="text-brand-500" />
        <h1 className="text-xl font-bold text-gray-900">Balanza de Comprobación</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <label className="text-sm font-medium text-gray-600 shrink-0">Desde:</label>
        <Input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="w-36" />
        <label className="text-sm font-medium text-gray-600 shrink-0">Hasta:</label>
        <Input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="w-36" />
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando Balanza" onRetry={() => refetch()} />}

      {!isLoading && !error && !data && (
        <EmptyState title="Sin datos" description="Ajusta el rango de fechas." />
      )}

      {data && (
        <div className="space-y-4">
          {/* Estado de cuadre — si no cuadra lo mostramos, no lo escondemos */}
          {!data.cuadra && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 font-semibold">
              ⚠ La balanza NO cuadra: Σdebe ({new Decimal(data.totalDebe).toFixed(2)}) ≠ Σhaber ({new Decimal(data.totalHaber).toFixed(2)})
            </div>
          )}
          {data.cuadra && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 font-medium">
              ✓ Balanza cuadra — Σdebe = Σhaber = {new Decimal(data.totalDebe).toFixed(2)}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-6 py-3 font-medium">Código</th>
                  <th className="text-left px-4 py-3 font-medium">Cuenta</th>
                  <th className="text-right px-6 py-3 font-medium">Σ Debe</th>
                  <th className="text-right px-6 py-3 font-medium">Σ Haber</th>
                  <th className="text-right px-6 py-3 font-medium">Saldo deudor</th>
                  <th className="text-right px-6 py-3 font-medium">Saldo acreedor</th>
                </tr>
              </thead>
              <tbody>
                {data.filas.map((f) => (
                  <tr key={f.cuentaCodigo} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-6 py-2.5 font-mono text-xs text-gray-500">{f.cuentaCodigo}</td>
                    <td className="px-4 py-2.5 text-gray-800">{f.cuentaNombre}</td>
                    <td className="px-6 py-2.5 text-right tabular-nums">{new Decimal(f.totalDebe).toFixed(2)}</td>
                    <td className="px-6 py-2.5 text-right tabular-nums">{new Decimal(f.totalHaber).toFixed(2)}</td>
                    <td className="px-6 py-2.5 text-right tabular-nums font-medium">
                      {new Decimal(f.saldoDeudor).gt(0) ? new Decimal(f.saldoDeudor).toFixed(2) : ''}
                    </td>
                    <td className="px-6 py-2.5 text-right tabular-nums font-medium">
                      {new Decimal(f.saldoAcreedor).gt(0) ? new Decimal(f.saldoAcreedor).toFixed(2) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-100 font-bold text-sm">
                  <td colSpan={2} className="px-6 py-3">Totales</td>
                  <td className="px-6 py-3 text-right tabular-nums">{new Decimal(data.totalDebe).toFixed(2)}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{new Decimal(data.totalHaber).toFixed(2)}</td>
                  <td className="px-6 py-3"></td>
                  <td className="px-6 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
