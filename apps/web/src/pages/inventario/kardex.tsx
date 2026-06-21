import { useState } from 'react';
import { useAlmacenes, useStockAlmacen, useKardex, type KardexLinea } from '@/hooks/use-inventario';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { TrendingUp } from 'lucide-react';

const TIPO_BADGE: Record<string, 'success' | 'danger' | 'info' | 'warning' | 'default'> = {
  ENTRADA: 'success',
  SALIDA: 'danger',
  RECEPCION: 'success',
  CONSUMO_OBRA: 'danger',
  TRANSFERENCIA: 'info',
  AJUSTE: 'warning',
};

const columns: ColumnDef<KardexLinea>[] = [
  {
    accessorKey: 'fecha',
    header: 'Fecha',
    cell: ({ row }) => (
      <span className="text-xs text-gray-600">{row.original.fecha}</span>
    ),
  },
  {
    accessorKey: 'tipoMovimiento',
    header: 'Tipo',
    cell: ({ row }) => {
      const tipo = row.original.tipoMovimiento;
      return (
        <Badge variant={TIPO_BADGE[tipo] ?? 'default'}>
          {tipo.replace(/_/g, ' ')}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'entrada',
    header: 'Entrada',
    cell: ({ row }) => (
      <span className="tabular-nums text-green-700 font-medium">
        {row.original.entrada
          ? parseFloat(row.original.entrada).toLocaleString('es-DO', { minimumFractionDigits: 2 })
          : '—'}
      </span>
    ),
  },
  {
    accessorKey: 'salida',
    header: 'Salida',
    cell: ({ row }) => (
      <span className="tabular-nums text-red-700 font-medium">
        {row.original.salida
          ? parseFloat(row.original.salida).toLocaleString('es-DO', { minimumFractionDigits: 2 })
          : '—'}
      </span>
    ),
  },
  {
    accessorKey: 'saldo',
    header: 'Saldo',
    cell: ({ row }) => (
      <span className="tabular-nums font-bold text-gray-900">
        {parseFloat(row.original.saldo).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    accessorKey: 'costoUnitario',
    header: 'Costo U.',
    cell: ({ row }) => (
      <span className="tabular-nums text-gray-700">
        {parseFloat(row.original.costoUnitario).toLocaleString('es-DO', { minimumFractionDigits: 4 })}
      </span>
    ),
  },
  {
    accessorKey: 'costoTotal',
    header: 'Costo total',
    cell: ({ row }) => (
      <span className="tabular-nums text-gray-700">
        {parseFloat(row.original.costoTotal).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    accessorKey: 'costoPromedio',
    header: 'WAC',
    cell: ({ row }) => (
      <span className="tabular-nums font-semibold text-brand-600">
        {parseFloat(row.original.costoPromedio).toLocaleString('es-DO', { minimumFractionDigits: 4 })}
      </span>
    ),
  },
  {
    accessorKey: 'referencia',
    header: 'Ref.',
    cell: ({ row }) => (
      <span className="text-xs font-mono text-gray-400">{row.original.referencia ?? '—'}</span>
    ),
  },
];

export function KardexPage() {
  const [almacenId, setAlmacenId] = useState('');
  const [insumoId, setInsumoId] = useState('');

  const { data: almacenes = [], isLoading: loadingAlmacenes } = useAlmacenes();
  const { data: stock = [], isLoading: loadingStock } = useStockAlmacen(almacenId);
  const { data: kardex = [], isLoading, error, refetch } = useKardex(almacenId, insumoId);

  const insumoSeleccionado = stock.find((s) => s.insumoId === insumoId);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Kardex por Insumo</h1>
        <p className="text-sm text-gray-500 mt-0.5">Historial de movimientos con costo promedio ponderado (WAC)</p>
      </div>

      {/* Selectores */}
      <div className="flex gap-4 items-center flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600 shrink-0">Almacén:</label>
          <select
            value={almacenId}
            onChange={(e) => { setAlmacenId(e.target.value); setInsumoId(''); }}
            disabled={loadingAlmacenes}
            className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[180px]"
          >
            <option value="">Seleccionar…</option>
            {almacenes.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600 shrink-0">Insumo:</label>
          <select
            value={insumoId}
            onChange={(e) => setInsumoId(e.target.value)}
            disabled={!almacenId || loadingStock}
            className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[220px] disabled:opacity-50"
          >
            <option value="">Seleccionar insumo…</option>
            {stock.map((s) => (
              <option key={s.insumoId} value={s.insumoId}>
                {s.nombreInsumo} — saldo: {parseFloat(s.cantidadDisponible).toFixed(2)} {s.unidadMedida}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Resumen del insumo seleccionado */}
      {insumoSeleccionado && (
        <div className="flex gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Saldo actual</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
              {parseFloat(insumoSeleccionado.cantidadDisponible).toLocaleString('es-DO', { minimumFractionDigits: 2 })} {insumoSeleccionado.unidadMedida}
            </p>
          </div>
          <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 flex-1">
            <p className="text-xs font-medium text-brand-600 uppercase tracking-wide flex items-center gap-1">
              <TrendingUp size={12} />
              WAC actual
            </p>
            <p className="text-xl font-bold text-brand-700 mt-1 tabular-nums">
              {insumoSeleccionado.moneda} {parseFloat(insumoSeleccionado.costoPromedio).toLocaleString('es-DO', { minimumFractionDigits: 4 })}
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Valor en stock</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
              {insumoSeleccionado.moneda} {(
                parseFloat(insumoSeleccionado.cantidadDisponible) *
                parseFloat(insumoSeleccionado.costoPromedio)
              ).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      )}

      {!almacenId || !insumoId ? (
        <EmptyState
          title="Selecciona almacén e insumo"
          description="Elige un almacén y luego el insumo para ver el kardex detallado."
          icon={<TrendingUp size={48} />}
        />
      ) : (
        <>
          {isLoading && <LoadingSpinner />}
          {error && <ErrorState message="Error cargando kardex" onRetry={() => refetch()} />}

          {!isLoading && !error && (
            <>
              {kardex.length === 0 ? (
                <EmptyState
                  title="Sin movimientos"
                  description="Este insumo no tiene movimientos registrados en el almacén seleccionado."
                />
              ) : (
                <DataTable
                  columns={columns}
                  data={kardex}
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
