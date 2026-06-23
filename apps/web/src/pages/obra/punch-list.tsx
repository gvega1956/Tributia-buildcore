import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { zPunchListCreate, type PunchListCreateInput } from '@tributia/obra';
import {
  usePunchList,
  useCreatePunchItem,
  useActualizarEstadoPunch,
  type PunchItem,
  type EstadoPunchItem,
} from '@/hooks/use-obra';
import { useProyectos } from '@/hooks/use-proyectos';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ApprovalActions } from '@/components/ui/approval-actions';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';

const ESTADO_BADGE: Record<EstadoPunchItem, 'default' | 'info' | 'success' | 'danger'> = {
  PENDIENTE: 'default',
  EN_PROGRESO: 'info',
  COMPLETADO: 'success',
  RECHAZADO: 'danger',
};

const ESTADO_LABEL: Record<EstadoPunchItem, string> = {
  PENDIENTE: 'Pendiente',
  EN_PROGRESO: 'En progreso',
  COMPLETADO: 'Completado',
  RECHAZADO: 'Rechazado',
};

function FormField({ label, error, required, children }: {
  label: string; error?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const columns: ColumnDef<PunchItem>[] = [
  {
    accessorKey: 'descripcion',
    header: 'Defecto / Tarea',
    cell: ({ row }) => <span className="text-sm text-gray-900 line-clamp-2">{row.original.descripcion}</span>,
  },
  {
    accessorKey: 'ubicacion',
    header: 'Ubicación',
    cell: ({ row }) => <span className="text-sm text-gray-600">{row.original.ubicacion ?? '—'}</span>,
  },
  {
    accessorKey: 'estado',
    header: 'Estado',
    cell: ({ row }) => (
      <Badge variant={ESTADO_BADGE[row.original.estado]}>
        {ESTADO_LABEL[row.original.estado]}
      </Badge>
    ),
  },
  {
    accessorKey: 'fechaLimite',
    header: 'Límite',
    cell: ({ row }) => row.original.fechaLimite ?? '—',
  },
  {
    accessorKey: 'createdAt',
    header: 'Creado',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('es-DO'),
  },
];

export function PunchListPage() {
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<PunchItem | null>(null);
  const [proyectoFiltro, setProyectoFiltro] = useState('');

  const { data: items = [], isLoading, error, refetch } = usePunchList(proyectoFiltro || undefined);
  const { data: proyectos = [] } = useProyectos();
  const crearMut = useCreatePunchItem();
  const actualizarMut = useActualizarEstadoPunch();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PunchListCreateInput>({
    resolver: zodResolver(zPunchListCreate),
    defaultValues: { proyectoId: '', descripcion: '' },
  });

  async function onSubmit(values: PunchListCreateInput) {
    try {
      await crearMut.mutateAsync(values);
      toast.success('Defecto registrado');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error creando defecto');
    }
  }

  async function handleEstado(estado: 'EN_PROGRESO' | 'COMPLETADO' | 'RECHAZADO') {
    if (!selected) return;
    try {
      await actualizarMut.mutateAsync({ id: selected.id, input: { estado } });
      toast.success(`Estado actualizado a ${ESTADO_LABEL[estado]}`);
      setSelected(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error actualizando estado');
    }
  }

  // Estadísticas
  const pendientes   = items.filter((i) => i.estado === 'PENDIENTE').length;
  const enProgreso   = items.filter((i) => i.estado === 'EN_PROGRESO').length;
  const completados  = items.filter((i) => i.estado === 'COMPLETADO').length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Punch List</h1>
          <p className="text-sm text-gray-500 mt-0.5">Defectos y tareas de cierre de obra</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Nuevo defecto
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-600 shrink-0">Proyecto:</label>
        <select
          value={proyectoFiltro}
          onChange={(e) => setProyectoFiltro(e.target.value)}
          className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[200px]"
        >
          <option value="">Todos</option>
          {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      {/* KPIs */}
      {!isLoading && items.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Pendientes</p>
            <p className="text-2xl font-bold text-amber-600 mt-1 tabular-nums">{pendientes}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">En progreso</p>
            <p className="text-2xl font-bold text-blue-600 mt-1 tabular-nums">{enProgreso}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Completados</p>
            <p className="text-2xl font-bold text-green-600 mt-1 tabular-nums">{completados}</p>
          </div>
        </div>
      )}

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando punch list" onRetry={() => refetch()} />}
      {!isLoading && !error && (
        items.length === 0
          ? <EmptyState title="Sin defectos registrados" description="Registra defectos o tareas pendientes de cierre de obra." action={<Button size="sm" onClick={() => setShowForm(true)}>Nuevo defecto</Button>} />
          : <DataTable columns={columns} data={items} searchColumn="descripcion" searchPlaceholder="Buscar defecto…" onRowClick={setSelected} />
      )}

      {/* Detalle / Cambiar estado */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title="Detalle de defecto" size="md">
          <div className="space-y-4">
            <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{selected.descripcion}</p>
            {selected.ubicacion && (
              <p className="text-xs text-gray-500">Ubicación: <span className="font-medium text-gray-700">{selected.ubicacion}</span></p>
            )}

            {/* Bandeja de aprobación reutilizada */}
            <ApprovalActions
              estadoLabel={ESTADO_LABEL[selected.estado]}
              estadoBadge={ESTADO_BADGE[selected.estado]}
              canEnviar={selected.estado === 'PENDIENTE'}
              canAprobar={selected.estado === 'EN_PROGRESO'}
              canRechazar={selected.estado !== 'COMPLETADO' && selected.estado !== 'RECHAZADO'}
              canAnular={false}
              isPending={actualizarMut.isPending}
              onEnviar={() => handleEstado('EN_PROGRESO')}
              onAprobar={() => handleEstado('COMPLETADO')}
              onRechazar={() => handleEstado('RECHAZADO')}
            />
          </div>
        </Modal>
      )}

      {/* Modal: Nuevo defecto */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Registrar defecto" size="md">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Proyecto" required error={errors.proyectoId?.message}>
            <select
              {...register('proyectoId')}
              className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Seleccionar…</option>
              {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </FormField>
          <FormField label="Descripción del defecto" required error={errors.descripcion?.message}>
            <textarea
              {...register('descripcion')}
              rows={3}
              placeholder="Describe el defecto o tarea pendiente de cierre…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Ubicación">
              <Input {...register('ubicacion')} placeholder="Bloque A, piso 3…" />
            </FormField>
            <FormField label="Fecha límite">
              <Input type="date" {...register('fechaLimite')} />
            </FormField>
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            {crearMut.isPending ? 'Guardando…' : 'Registrar defecto'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
