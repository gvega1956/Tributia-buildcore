import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { zOrdenCambioCreate, CAUSAS_OC, type OrdenCambioCreateInput } from '@tributia/ordenes-cambio';
import { useOrdenesCambio, useCreateOrdenCambio, type OrdenCambio } from '@/hooks/use-ordenes-cambio';
import { useProyectos } from '@/hooks/use-proyectos';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';

const ESTADO_BADGE: Record<string, 'default' | 'info' | 'success' | 'danger' | 'warning'> = {
  BORRADOR: 'default',
  ENVIADA_CLIENTE: 'info',
  APROBADA: 'success',
  RECHAZADA: 'danger',
  ANULADA: 'warning',
};

const ESTADO_LABEL: Record<string, string> = {
  BORRADOR: 'Borrador',
  ENVIADA_CLIENTE: 'Enviada al cliente',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  ANULADA: 'Anulada',
};

const CAUSA_LABEL: Record<string, string> = {
  CLIENTE: 'Cambio del cliente',
  DISENO: 'Error de diseño',
  CAMPO: 'Condición de campo',
  IMPREVISTO: 'Imprevisto',
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

const columns: ColumnDef<OrdenCambio>[] = [
  {
    accessorKey: 'causa',
    header: 'Causa',
    cell: ({ row }) => (
      <span className="text-sm font-medium text-gray-800">{CAUSA_LABEL[row.original.causa] ?? row.original.causa}</span>
    ),
  },
  {
    accessorKey: 'descripcion',
    header: 'Descripción',
    cell: ({ row }) => <span className="text-sm text-gray-700 line-clamp-2">{row.original.descripcion}</span>,
  },
  {
    accessorKey: 'estado',
    header: 'Estado',
    cell: ({ row }) => (
      <Badge variant={ESTADO_BADGE[row.original.estado] ?? 'default'}>
        {ESTADO_LABEL[row.original.estado] ?? row.original.estado}
      </Badge>
    ),
  },
  {
    id: 'lineas',
    header: 'Líneas',
    cell: ({ row }) => <span className="tabular-nums text-sm">{row.original.lineas.length}</span>,
  },
  {
    accessorKey: 'diasAdicionalesSolicitados',
    header: 'Días sol.',
    cell: ({ row }) => row.original.diasAdicionalesSolicitados != null
      ? <span className="tabular-nums">{row.original.diasAdicionalesSolicitados}d</span>
      : '—',
  },
  {
    accessorKey: 'createdAt',
    header: 'Fecha',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('es-DO'),
  },
];

interface ListaOrdenesCambioProps {
  onSelect: (oc: OrdenCambio) => void;
}

export function ListaOrdenesCambio({ onSelect }: ListaOrdenesCambioProps) {
  const [showForm, setShowForm] = useState(false);
  const [proyectoFiltro, setProyectoFiltro] = useState('');

  const { data: ordenes = [], isLoading, error, refetch } = useOrdenesCambio(proyectoFiltro || undefined);
  const { data: proyectos = [] } = useProyectos();
  const crearMut = useCreateOrdenCambio();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<OrdenCambioCreateInput>({
    resolver: zodResolver(zOrdenCambioCreate),
    defaultValues: { proyectoId: '', empresaId: '', causa: 'CAMPO', descripcion: '' },
  });

  async function onSubmit(values: OrdenCambioCreateInput) {
    try {
      const oc = await crearMut.mutateAsync(values);
      toast.success('Orden de cambio creada');
      reset();
      setShowForm(false);
      onSelect(oc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error creando orden de cambio');
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Órdenes de Cambio</h1>
          <p className="text-sm text-gray-500 mt-0.5">Modificaciones al contrato original — toda OC aprobada actualiza el presupuesto vigente</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Nueva OC
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

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando órdenes de cambio" onRetry={() => refetch()} />}
      {!isLoading && !error && (
        ordenes.length === 0
          ? <EmptyState title="Sin órdenes de cambio" description="Las modificaciones al contrato aprobadas por el cliente se registran aquí." action={<Button size="sm" onClick={() => setShowForm(true)}>Nueva OC</Button>} />
          : <DataTable columns={columns} data={ordenes} searchColumn="descripcion" searchPlaceholder="Buscar OC…" onRowClick={onSelect} />
      )}

      {/* Modal: Nueva OC */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nueva Orden de Cambio" size="md">
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
          <FormField label="Empresa" required error={errors.empresaId?.message}>
            <select
              {...register('empresaId')}
              className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Seleccionar…</option>
              {proyectos.map((p) => <option key={p.id} value={p.empresaId}>{p.empresaId.slice(0, 8)}…</option>)}
            </select>
          </FormField>
          <FormField label="Causa" required error={errors.causa?.message}>
            <select
              {...register('causa')}
              className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {CAUSAS_OC.map((c) => <option key={c} value={c}>{CAUSA_LABEL[c]}</option>)}
            </select>
          </FormField>
          <FormField label="Descripción del cambio" required error={errors.descripcion?.message}>
            <textarea
              {...register('descripcion')}
              rows={3}
              placeholder="Describe el alcance de la modificación solicitada…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </FormField>
          <FormField label="Días adicionales solicitados">
            <Input type="number" min={0} {...register('diasAdicionalesSolicitados', { valueAsNumber: true })} placeholder="0" />
          </FormField>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            {crearMut.isPending ? 'Creando…' : 'Crear Orden de Cambio'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
