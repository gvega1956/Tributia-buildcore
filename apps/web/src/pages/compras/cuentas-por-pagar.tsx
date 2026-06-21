import { useCuentasPorPagar, type CuentaPorPagar } from '@/hooks/use-compras';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { AlertTriangle } from 'lucide-react';

const ESTADO_BADGE: Record<string, 'warning' | 'info' | 'success'> = {
  ABIERTA: 'warning',
  PAGADA_PARCIAL: 'info',
  PAGADA_TOTAL: 'success',
};

const ESTADO_LABELS: Record<string, string> = {
  ABIERTA: 'Abierta',
  PAGADA_PARCIAL: 'Pago parcial',
  PAGADA_TOTAL: 'Pagada',
};

function isVencida(fecha: string | null): boolean {
  if (!fecha) return false;
  return new Date(fecha) < new Date();
}

const columns: ColumnDef<CuentaPorPagar>[] = [
  {
    accessorKey: 'id',
    header: 'CxP',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-gray-500">{row.original.id.slice(0, 8)}…</span>
    ),
  },
  {
    accessorKey: 'terceroId',
    header: 'Proveedor',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-gray-500">{row.original.terceroId.slice(0, 8)}…</span>
    ),
  },
  {
    accessorKey: 'estado',
    header: 'Estado',
    cell: ({ row }) => (
      <Badge variant={ESTADO_BADGE[row.original.estado]}>
        {ESTADO_LABELS[row.original.estado]}
      </Badge>
    ),
  },
  {
    accessorKey: 'montoOriginal',
    header: 'Monto original',
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.moneda} {parseFloat(row.original.montoOriginal).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    accessorKey: 'saldoPendiente',
    header: 'Saldo pendiente',
    cell: ({ row }) => (
      <span className="tabular-nums font-semibold text-gray-900">
        {row.original.moneda} {parseFloat(row.original.saldoPendiente).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    accessorKey: 'fechaVencimientoPago',
    header: 'Vencimiento',
    cell: ({ row }) => {
      const fecha = row.original.fechaVencimientoPago;
      if (!fecha) return <span className="text-gray-400">—</span>;
      const vencida = isVencida(fecha) && row.original.estado !== 'PAGADA_TOTAL';
      return (
        <div className="flex items-center gap-1.5">
          {vencida && <AlertTriangle size={13} className="text-red-500" />}
          <span className={vencida ? 'text-red-600 font-medium' : 'text-gray-700'}>{fecha}</span>
        </div>
      );
    },
  },
];

export function CuentasPorPagarPage() {
  const { data: cxps = [], isLoading, error, refetch } = useCuentasPorPagar();

  const vencidas = cxps.filter(
    (c) => c.estado !== 'PAGADA_TOTAL' && isVencida(c.fechaVencimientoPago),
  );

  const totalPendiente = cxps
    .filter((c) => c.estado !== 'PAGADA_TOTAL')
    .reduce((sum, c) => sum + parseFloat(c.saldoPendiente), 0);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Cuentas por Pagar</h1>
        <p className="text-sm text-gray-500 mt-0.5">Obligaciones con proveedores pendientes de pago</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total pendiente</p>
          <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
            DOP {totalPendiente.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">CxP activas</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {cxps.filter((c) => c.estado !== 'PAGADA_TOTAL').length}
          </p>
        </div>
        <div className={`border rounded-xl p-4 ${vencidas.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
          <p className={`text-xs font-medium uppercase tracking-wide ${vencidas.length > 0 ? 'text-red-600' : 'text-gray-500'}`}>
            Vencidas
          </p>
          <p className={`text-2xl font-bold mt-1 ${vencidas.length > 0 ? 'text-red-700' : 'text-gray-900'}`}>
            {vencidas.length}
          </p>
        </div>
      </div>

      {/* Alerta vencidas */}
      {vencidas.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-800">
            Hay <strong>{vencidas.length}</strong> cuenta{vencidas.length > 1 ? 's' : ''} vencida{vencidas.length > 1 ? 's' : ''} —
            el scoring de proveedores se ve afectado por pagos tardíos.
          </p>
        </div>
      )}

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando cuentas por pagar" onRetry={() => refetch()} />}

      {!isLoading && !error && (
        <>
          {cxps.length === 0 ? (
            <EmptyState
              title="Sin cuentas por pagar"
              description="Las CxP se crean automáticamente al registrar una factura de proveedor."
            />
          ) : (
            <DataTable
              columns={columns}
              data={cxps}
              searchPlaceholder="Buscar CxP…"
            />
          )}
        </>
      )}
    </div>
  );
}
