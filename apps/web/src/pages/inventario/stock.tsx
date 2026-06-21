import { useState } from 'react';
import { useAlmacenes, useStockAlmacen, type StockItem } from '@/hooks/use-inventario';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { BarChart3 } from 'lucide-react';

function StockBadge({ cantidad }: { cantidad: string }) {
  const n = parseFloat(cantidad);
  const variant = n === 0 ? 'danger' : n < 10 ? 'warning' : 'success';
  return <Badge variant={variant}>{n === 0 ? 'Agotado' : n < 10 ? 'Bajo stock' : 'OK'}</Badge>;
}

const columns: ColumnDef<StockItem>[] = [
  {
    accessorKey: 'codigoInsumo',
    header: 'Código',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-gray-500">{row.original.codigoInsumo ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'nombreInsumo',
    header: 'Insumo',
    cell: ({ row }) => <span className="font-medium text-gray-900">{row.original.nombreInsumo}</span>,
  },
  {
    accessorKey: 'unidadMedida',
    header: 'UM',
    cell: ({ row }) => <span className="text-xs text-gray-600">{row.original.unidadMedida}</span>,
  },
  {
    accessorKey: 'cantidadDisponible',
    header: 'Disponible',
    cell: ({ row }) => (
      <span className="tabular-nums font-semibold text-gray-900">
        {parseFloat(row.original.cantidadDisponible).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    accessorKey: 'costoPromedio',
    header: 'Costo prom. (WAC)',
    cell: ({ row }) => (
      <span className="tabular-nums text-gray-700">
        {row.original.moneda} {parseFloat(row.original.costoPromedio).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    id: 'valorTotal',
    header: 'Valor en stock',
    cell: ({ row }) => {
      const total = parseFloat(row.original.cantidadDisponible) * parseFloat(row.original.costoPromedio);
      return (
        <span className="tabular-nums font-medium text-gray-900">
          {row.original.moneda} {total.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
        </span>
      );
    },
  },
  {
    id: 'estado',
    header: 'Estado',
    cell: ({ row }) => <StockBadge cantidad={row.original.cantidadDisponible} />,
  },
];

export function StockPage() {
  const [almacenId, setAlmacenId] = useState('');

  const { data: almacenes = [], isLoading: loadingAlmacenes } = useAlmacenes();
  const { data: stock = [], isLoading: loadingStock, error, refetch } = useStockAlmacen(almacenId);

  const valorTotal = stock.reduce(
    (sum, s) => sum + parseFloat(s.cantidadDisponible) * parseFloat(s.costoPromedio),
    0,
  );

  const agotados = stock.filter((s) => parseFloat(s.cantidadDisponible) === 0);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Stock por Almacén</h1>
        <p className="text-sm text-gray-500 mt-0.5">Inventario disponible con costo promedio ponderado (WAC)</p>
      </div>

      {/* Selector de almacén */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-600 shrink-0">Almacén:</label>
        <select
          value={almacenId}
          onChange={(e) => setAlmacenId(e.target.value)}
          disabled={loadingAlmacenes}
          className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[200px]"
        >
          <option value="">Seleccionar almacén…</option>
          {almacenes.map((a) => (
            <option key={a.id} value={a.id}>{a.nombre} ({a.tipo})</option>
          ))}
        </select>
      </div>

      {!almacenId ? (
        <EmptyState
          title="Selecciona un almacén"
          description="Elige un almacén del selector para ver su stock disponible."
          icon={<BarChart3 size={48} />}
        />
      ) : (
        <>
          {loadingStock && <LoadingSpinner />}
          {error && <ErrorState message="Error cargando stock" onRetry={() => refetch()} />}

          {!loadingStock && !error && (
            <>
              {/* KPIs */}
              {stock.length > 0 && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Valor en stock</p>
                    <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                      DOP {valorTotal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Insumos distintos</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{stock.length}</p>
                  </div>
                  <div className={`border rounded-xl p-4 ${agotados.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                    <p className={`text-xs font-medium uppercase tracking-wide ${agotados.length > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                      Agotados
                    </p>
                    <p className={`text-xl font-bold mt-1 ${agotados.length > 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {agotados.length}
                    </p>
                  </div>
                </div>
              )}

              {stock.length === 0 ? (
                <EmptyState
                  title="Sin stock en este almacén"
                  description="Este almacén no tiene movimientos registrados todavía."
                />
              ) : (
                <DataTable
                  columns={columns}
                  data={stock}
                  searchColumn="nombreInsumo"
                  searchPlaceholder="Buscar insumo…"
                  pageSize={50}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
