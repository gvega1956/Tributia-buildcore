import { useNavigate } from 'react-router-dom';
import { Plus, Building2 } from 'lucide-react';
import type { ColumnDef } from '@/components/ui/data-table';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { useProyectos, type Proyecto } from '@/hooks/use-proyectos';
import { ESTADO_LABELS, ESTADO_BADGE, formatMoney, formatFecha } from '@/lib/proyecto-utils';

const columns: ColumnDef<Proyecto>[] = [
  {
    accessorKey: 'codigo',
    header: 'Código',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-gray-500">{row.original.codigo}</span>
    ),
  },
  {
    accessorKey: 'nombre',
    header: 'Nombre',
    cell: ({ row }) => (
      <span className="font-semibold text-gray-900">{row.original.nombre}</span>
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
    accessorKey: 'tipoObra',
    header: 'Tipo',
    cell: ({ row }) => (
      <span className="text-xs bg-gray-100 rounded px-2 py-0.5 whitespace-nowrap">
        {row.original.tipoObra}
      </span>
    ),
  },
  {
    accessorKey: 'montoContrato',
    header: 'Monto contrato',
    cell: ({ row }) => (
      <span className="tabular-nums text-right block text-sm">
        {formatMoney(row.original.montoContrato, row.original.monedaContrato)}
      </span>
    ),
  },
  {
    accessorKey: 'fechaFinPlanificada',
    header: 'Fin planificado',
    cell: ({ row }) => (
      <span className="text-xs text-gray-500 whitespace-nowrap">
        {formatFecha(row.original.fechaFinPlanificada)}
      </span>
    ),
  },
];

export function ProyectosPage() {
  const navigate = useNavigate();
  const { data: proyectos = [], isLoading, error, refetch } = useProyectos();

  if (error) {
    return (
      <div className="p-8">
        <ErrorState
          message={error instanceof Error ? error.message : 'Error cargando proyectos'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proyectos</h1>
          {!isLoading && (
            <p className="text-gray-500 text-sm mt-1">
              {proyectos.length} proyecto{proyectos.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Button onClick={() => navigate('/proyectos/nuevo')}>
          <Plus size={16} className="mr-2" />
          Nuevo proyecto
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : proyectos.length === 0 ? (
        <EmptyState
          icon={<Building2 size={48} />}
          title="Sin proyectos aún"
          description="Crea el primer proyecto para comenzar a registrar obra."
          action={
            <Button size="sm" onClick={() => navigate('/proyectos/nuevo')}>
              <Plus size={14} className="mr-1.5" /> Nuevo proyecto
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={proyectos}
          searchColumn="nombre"
          searchPlaceholder="Buscar por nombre…"
          onRowClick={(p) => navigate(`/proyectos/${p.id}`)}
        />
      )}
    </div>
  );
}
