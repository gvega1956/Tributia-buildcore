import { useState } from 'react';
import { BookOpen, ChevronRight, ExternalLink } from 'lucide-react';
import {
  useLibroDiario,
  useDetalleAsiento,
  type AsientoContable,
} from '@/hooks/use-contabilidad';
import { useProyectos } from '@/hooks/use-proyectos';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import Decimal from 'decimal.js';

const HOY = new Date().toISOString().slice(0, 10);
const PRIMER_DIA_MES = HOY.slice(0, 7) + '-01';

const TIPO_BADGE: Record<string, 'default' | 'info' | 'warning' | 'success'> = {
  automatico: 'info',
  ajuste: 'warning',
  apertura: 'success',
  cierre: 'default',
};

const TIPO_LABEL: Record<string, string> = {
  automatico: 'Automático',
  ajuste: 'Ajuste',
  apertura: 'Apertura',
  cierre: 'Cierre',
};

const columns: ColumnDef<AsientoContable>[] = [
  {
    accessorKey: 'fecha',
    header: 'Fecha',
    cell: ({ row }) => <span className="font-medium text-gray-900">{row.original.fecha}</span>,
  },
  {
    accessorKey: 'tipo',
    header: 'Tipo',
    cell: ({ row }) => (
      <Badge variant={TIPO_BADGE[row.original.tipo] ?? 'default'}>
        {TIPO_LABEL[row.original.tipo] ?? row.original.tipo}
      </Badge>
    ),
  },
  {
    accessorKey: 'descripcion',
    header: 'Descripción',
    cell: ({ row }) => <span className="text-sm text-gray-700 line-clamp-2">{row.original.descripcion}</span>,
  },
  {
    id: 'debe',
    header: 'Σ Debe',
    cell: ({ row }) => {
      const total = row.original.lineas
        .filter((l) => l.tipo === 'debe')
        .reduce((s, l) => s.plus(l.importe), new Decimal(0));
      return <span className="tabular-nums text-sm font-semibold text-right">{total.toFixed(2)}</span>;
    },
  },
  {
    id: 'haber',
    header: 'Σ Haber',
    cell: ({ row }) => {
      const total = row.original.lineas
        .filter((l) => l.tipo === 'haber')
        .reduce((s, l) => s.plus(l.importe), new Decimal(0));
      return <span className="tabular-nums text-sm font-semibold text-right">{total.toFixed(2)}</span>;
    },
  },
  {
    id: 'trace',
    header: '',
    cell: ({ row }) => row.original.eventoId
      ? <span className="text-xs text-brand-500 flex items-center gap-0.5"><ExternalLink size={11} />Evento</span>
      : null,
  },
];

function DetalleAsientoPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useDetalleAsiento(id);
  if (isLoading) return <LoadingSpinner />;
  if (!data) return null;

  const totalDebe = data.lineas.filter((l) => l.tipo === 'debe').reduce((s, l) => s.plus(l.importe), new Decimal(0));
  const totalHaber = data.lineas.filter((l) => l.tipo === 'haber').reduce((s, l) => s.plus(l.importe), new Decimal(0));
  const cuadra = totalDebe.equals(totalHaber);

  return (
    <Modal open title={`Asiento ${data.fecha} — ${TIPO_LABEL[data.tipo] ?? data.tipo}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-gray-700">{data.descripcion}</p>

        {/* Trazabilidad P8: del asiento al evento operativo */}
        {data.eventoId && (
          <div className="flex items-center gap-2 p-3 bg-brand-50 border border-brand-100 rounded-xl text-xs">
            <ChevronRight size={13} className="text-brand-500" />
            <span className="text-brand-700 font-medium">Origen:</span>
            <span className="font-mono text-brand-600">{data.eventoId}</span>
            <span className="text-brand-400">(evento operativo)</span>
          </div>
        )}

        {/* Líneas del asiento */}
        <table className="w-full text-sm border-t border-gray-100">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Cuenta</th>
              <th className="text-right px-4 py-2 font-medium">Debe</th>
              <th className="text-right px-4 py-2 font-medium">Haber</th>
            </tr>
          </thead>
          <tbody>
            {data.lineas.map((l) => (
              <tr key={l.id} className="border-t border-gray-50">
                <td className="px-4 py-2">
                  <span className="font-mono text-xs text-gray-500 mr-2">{l.cuentaCodigo}</span>
                  <span className="text-gray-800">{l.cuentaNombre}</span>
                  {l.descripcion && <span className="text-gray-400 text-xs ml-2">— {l.descripcion}</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">
                  {l.tipo === 'debe' ? new Decimal(l.importe).toFixed(2) : ''}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">
                  {l.tipo === 'haber' ? new Decimal(l.importe).toFixed(2) : ''}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
              <td className="px-4 py-2 text-sm">Totales</td>
              <td className="px-4 py-2 text-right tabular-nums">{totalDebe.toFixed(2)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{totalHaber.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        {/* Alerta si no cuadra — "no esconder lo que no cuadra" */}
        {!cuadra && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-semibold">
            ⚠ Este asiento NO cuadra: Σdebe ({totalDebe.toFixed(2)}) ≠ Σhaber ({totalHaber.toFixed(2)})
          </div>
        )}
      </div>
    </Modal>
  );
}

export function LibroDiarioPage() {
  const [fechaDesde, setFechaDesde] = useState(PRIMER_DIA_MES);
  const [fechaHasta, setFechaHasta] = useState(HOY);
  const [proyectoFiltro, setProyectoFiltro] = useState('');
  const [asientoId, setAsientoId] = useState<string | null>(null);

  const { data: proyectos = [] } = useProyectos();
  const { data: asientos = [], isLoading, error, refetch } = useLibroDiario({
    fechaDesde,
    fechaHasta,
    ...(proyectoFiltro ? { proyectoId: proyectoFiltro } : {}),
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen size={18} className="text-brand-500" />
        <h1 className="text-xl font-bold text-gray-900">Libro Diario</h1>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
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
          <option value="">Todos</option>
          {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando Libro Diario" onRetry={() => refetch()} />}
      {!isLoading && !error && (
        asientos.length === 0
          ? <EmptyState title="Sin asientos en el período" description="Ajusta el rango de fechas o el filtro de proyecto." />
          : (
            <DataTable
              columns={columns}
              data={asientos}
              searchColumn="descripcion"
              searchPlaceholder="Buscar asiento…"
              onRowClick={(a) => setAsientoId(a.id)}
            />
          )
      )}

      {asientoId && <DetalleAsientoPanel id={asientoId} onClose={() => setAsientoId(null)} />}
    </div>
  );
}
