import { useState } from 'react';
import { DollarSign, AlertTriangle, Clock } from 'lucide-react';
import {
  useCuentasPorCobrar,
  useAgingPorCliente,
  useAgingPorProyecto,
  useRegistrarCobroCxC,
  type CuentaPorCobrar,
} from '@/hooks/use-cxc';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import Decimal from 'decimal.js';

const ESTADO_BADGE: Record<string, 'warning' | 'info' | 'success' | 'danger'> = {
  PENDIENTE: 'warning',
  PARCIAL: 'info',
  COBRADA: 'success',
  VENCIDA: 'danger',
};

const columns: ColumnDef<CuentaPorCobrar>[] = [
  { accessorKey: 'terceroNombre', header: 'Cliente', cell: ({ row }) => <span className="font-medium">{row.original.terceroNombre}</span> },
  {
    accessorKey: 'monto',
    header: 'Monto original',
    cell: ({ row }) => <span className="tabular-nums">{new Decimal(row.original.monto).toFixed(2)} {row.original.moneda}</span>,
  },
  {
    accessorKey: 'saldo',
    header: 'Saldo pendiente',
    cell: ({ row }) => <span className="tabular-nums font-semibold">{new Decimal(row.original.saldo).toFixed(2)}</span>,
  },
  { accessorKey: 'fechaVencimiento', header: 'Vence' },
  {
    accessorKey: 'estado',
    header: 'Estado',
    cell: ({ row }) => <Badge variant={ESTADO_BADGE[row.original.estado] ?? 'default'}>{row.original.estado}</Badge>,
  },
];

export function AgingPage() {
  const [view, setView] = useState<'lista' | 'por-cliente' | 'por-proyecto'>('lista');
  const [selected, setSelected] = useState<CuentaPorCobrar | null>(null);
  const [montoCobro, setMontoCobro] = useState('');

  const cxcQ = useCuentasPorCobrar();
  const porClienteQ = useAgingPorCliente();
  const porProyectoQ = useAgingPorProyecto();
  const cobrarMut = useRegistrarCobroCxC();

  // KPIs
  const cxcs = cxcQ.data ?? [];
  const totalPendiente = cxcs
    .filter((c) => c.estado !== 'COBRADA')
    .reduce((s, c) => s.plus(c.saldo), new Decimal(0));
  const vencidas = cxcs.filter((c) => c.estado === 'VENCIDA').length;

  async function handleCobrar() {
    if (!selected || !montoCobro) return;
    try {
      // Acción financiera — espera confirmación del servidor
      await cobrarMut.mutateAsync({ id: selected.id, input: { monto: montoCobro } });
      toast.success('Cobro registrado');
      setSelected(null);
      setMontoCobro('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error registrando cobro');
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Cuentas por Cobrar — Aging</h1>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><DollarSign size={14} className="text-brand-500" /><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total pendiente</p></div>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{totalPendiente.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><Clock size={14} className="text-amber-500" /><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">CxC activas</p></div>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{cxcs.filter((c) => c.estado !== 'COBRADA').length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><AlertTriangle size={14} className="text-red-500" /><p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Vencidas</p></div>
          <p className="text-2xl font-bold text-red-600 tabular-nums">{vencidas}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['lista', 'por-cliente', 'por-proyecto'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === v ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:text-gray-900'}`}
          >
            {v === 'lista' ? 'Lista CxC' : v === 'por-cliente' ? 'Aging por cliente' : 'Aging por proyecto'}
          </button>
        ))}
      </div>

      {/* Lista CxC */}
      {view === 'lista' && (
        <>
          {cxcQ.isLoading && <LoadingSpinner />}
          {cxcQ.error && <ErrorState message="Error cargando CxC" onRetry={() => cxcQ.refetch()} />}
          {!cxcQ.isLoading && !cxcQ.error && (
            cxcs.length === 0
              ? <EmptyState title="Sin cuentas por cobrar" description="Las CxC se generan al emitir facturas al cliente." />
              : <DataTable columns={columns} data={cxcs} searchColumn="terceroNombre" searchPlaceholder="Buscar cliente…" onRowClick={setSelected} />
          )}
        </>
      )}

      {/* Aging por cliente */}
      {view === 'por-cliente' && (
        <>
          {porClienteQ.isLoading && <LoadingSpinner />}
          {porClienteQ.data && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-6 py-3">Cliente</th>
                    <th className="text-right px-4 py-3">Total</th>
                    {porClienteQ.data[0]?.buckets.map((b) => (
                      <th key={b.rango} className="text-right px-4 py-3">{b.rango}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {porClienteQ.data.map((row) => (
                    <tr key={row.terceroId} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium">{row.nombre}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{new Decimal(row.total).toFixed(2)}</td>
                      {row.buckets.map((b) => (
                        <td key={b.rango} className={`px-4 py-3 text-right tabular-nums ${new Decimal(b.total).gt(0) && b.rango.includes('+') ? 'text-red-600 font-medium' : ''}`}>
                          {new Decimal(b.total).gt(0) ? new Decimal(b.total).toFixed(2) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Aging por proyecto */}
      {view === 'por-proyecto' && (
        <>
          {porProyectoQ.isLoading && <LoadingSpinner />}
          {porProyectoQ.data && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-6 py-3">Proyecto</th>
                    <th className="text-right px-4 py-3">Total</th>
                    {porProyectoQ.data[0]?.buckets.map((b) => (
                      <th key={b.rango} className="text-right px-4 py-3">{b.rango}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {porProyectoQ.data.map((row) => (
                    <tr key={row.proyectoId} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium">{row.nombre}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{new Decimal(row.total).toFixed(2)}</td>
                      {row.buckets.map((b) => (
                        <td key={b.rango} className={`px-4 py-3 text-right tabular-nums ${new Decimal(b.total).gt(0) && b.rango.includes('+') ? 'text-red-600 font-medium' : ''}`}>
                          {new Decimal(b.total).gt(0) ? new Decimal(b.total).toFixed(2) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modal: Registrar cobro */}
      {selected && (
        <Modal open onClose={() => { setSelected(null); setMontoCobro(''); }} title={`Cobrar — ${selected.terceroNombre}`} size="sm">
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              Saldo pendiente: <span className="font-bold tabular-nums">{new Decimal(selected.saldo).toFixed(2)} {selected.moneda}</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto a cobrar <span className="text-red-500">*</span></label>
              <Input
                value={montoCobro}
                onChange={(e) => setMontoCobro(e.target.value)}
                placeholder="0.0000"
                autoFocus
              />
            </div>
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => { setSelected(null); setMontoCobro(''); }}>Cancelar</Button>
            <Button onClick={handleCobrar} disabled={!montoCobro || cobrarMut.isPending}>
              {cobrarMut.isPending ? 'Registrando…' : 'Registrar cobro'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
