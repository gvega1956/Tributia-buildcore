import { useState } from 'react';
import { useAlmacenes, useMovimientos, type MovimientoInventario } from '@/hooks/use-inventario';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { ArrowDownCircle, ArrowUpCircle, RefreshCw } from 'lucide-react';

const TIPO_ICON: Record<string, React.ElementType> = {
  ENTRADA: ArrowDownCircle,
  SALIDA: ArrowUpCircle,
  TRANSFERENCIA: RefreshCw,
  AJUSTE: RefreshCw,
};

const TIPO_BADGE: Record<string, 'success' | 'danger' | 'info' | 'warning' | 'default'> = {
  ENTRADA: 'success',
  SALIDA: 'danger',
  TRANSFERENCIA: 'info',
  AJUSTE: 'warning',
  CONSUMO_OBRA: 'danger',
  RECEPCION: 'success',
};

const columns: ColumnDef<MovimientoInventario>[] = [
  {
    accessorKey: 'createdAt',
    header: 'Fecha',
    cell: ({ row }) => (
      <span className="text-xs text-gray-500">
        {new Date(row.original.createdAt).toLocaleString('es-DO', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })}
      </span>
    ),
  },
  {
    accessorKey: 'tipoMovimiento',
    header: 'Tipo',
    cell: ({ row }) => {
      const tipo = row.original.tipoMovimiento;
      const Icon = TIPO_ICON[tipo] ?? RefreshCw;
      const variant = TIPO_BADGE[tipo] ?? 'default';
      return (
        <div className="flex items-center gap-1.5">
          <Icon size={13} className={
            variant === 'success' ? 'text-green-600' :
            variant === 'danger'  ? 'text-red-600' :
            variant === 'info'    ? 'text-blue-600' : 'text-gray-500'
          } />
          <Badge variant={variant}>{tipo.replace(/_/g, ' ')}</Badge>
        </div>
      );
    },
  },
  {
    accessorKey: 'insumoId',
    header: 'Insumo',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-gray-500">{row.original.insumoId.slice(0, 8)}…</span>
    ),
  },
  {
    accessorKey: 'cantidad',
    header: 'Cantidad',
    cell: ({ row }) => (
      <span className="tabular-nums font-medium text-gray-900">
        {parseFloat(row.original.cantidad).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    accessorKey: 'costoUnitario',
    header: 'Costo U.',
    cell: ({ row }) => (
      <span className="tabular-nums text-gray-700">
        {row.original.moneda} {parseFloat(row.original.costoUnitario).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    accessorKey: 'costoTotal',
    header: 'Total',
    cell: ({ row }) => (
      <span className="tabular-nums font-semibold text-gray-900">
        {row.original.moneda} {parseFloat(row.original.costoTotal).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    accessorKey: 'referencia',
    header: 'Referencia',
    cell: ({ row }) => (
      <span className="text-xs text-gray-500 font-mono">{row.original.referencia ?? '—'}</span>
    ),
  },
];

export function MovimientosPage() {
  const [almacenId, setAlmacenId] = useState('');

  const { data: almacenes = [], isLoading: loadingAlmacenes } = useAlmacenes();
  const { data: movimientos = [], isLoading, error, refetch } = useMovimientos(almacenId || undefined);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Movimientos de Inventario</h1>
        <p className="text-sm text-gray-500 mt-0.5">Entradas, salidas, transferencias y ajustes</p>
      </div>

      {/* Filtro */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-600 shrink-0">Almacén:</label>
        <select
          value={almacenId}
          onChange={(e) => setAlmacenId(e.target.value)}
          disabled={loadingAlmacenes}
          className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[200px]"
        >
          <option value="">Todos los almacenes</option>
          {almacenes.map((a) => (
            <option key={a.id} value={a.id}>{a.nombre}</option>
          ))}
        </select>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando movimientos" onRetry={() => refetch()} />}

      {!isLoading && !error && (
        <>
          {movimientos.length === 0 ? (
            <EmptyState
              title="Sin movimientos"
              description="Los movimientos se registran automáticamente al hacer recepciones, consumos y transferencias."
            />
          ) : (
            <DataTable
              columns={columns}
              data={movimientos}
              searchPlaceholder="Buscar movimiento…"
              pageSize={50}
            />
          )}
        </>
      )}
    </div>
  );
}
