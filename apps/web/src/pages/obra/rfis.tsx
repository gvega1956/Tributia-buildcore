import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, MessageSquare, CheckCircle } from 'lucide-react';
import { zRfiCreate, IMPACTOS_RFI, type RfiCreateInput } from '@tributia/obra';
import { useRfis, useCreateRfi, useResponderRfi, useCerrarRfi, type Rfi } from '@/hooks/use-obra';
import { useProyectos } from '@/hooks/use-proyectos';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';

const ESTADO_BADGE: Record<string, 'warning' | 'info' | 'success'> = {
  ABIERTA: 'warning',
  RESPONDIDA: 'info',
  CERRADA: 'success',
};

const ESTADO_LABEL: Record<string, string> = {
  ABIERTA: 'Abierta',
  RESPONDIDA: 'Respondida',
  CERRADA: 'Cerrada',
};

const IMPACTO_LABEL: Record<string, string> = {
  NINGUNO: 'Sin impacto',
  DIAS: 'Días adicionales',
  COSTO: 'Impacto costo',
  AMBOS: 'Costo y días',
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

const columns: ColumnDef<Rfi>[] = [
  {
    accessorKey: 'titulo',
    header: 'Título',
    cell: ({ row }) => <span className="font-medium text-gray-900 line-clamp-2">{row.original.titulo}</span>,
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
    accessorKey: 'impacto',
    header: 'Impacto',
    cell: ({ row }) => (
      <span className="text-sm text-gray-600">{IMPACTO_LABEL[row.original.impacto] ?? row.original.impacto}</span>
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

export function RfisPage() {
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Rfi | null>(null);
  const [respuesta, setRespuesta] = useState('');
  const [proyectoFiltro, setProyectoFiltro] = useState('');

  const { data: rfis = [], isLoading, error, refetch } = useRfis(proyectoFiltro || undefined);
  const { data: proyectos = [] } = useProyectos();
  const crearMut = useCreateRfi();
  const responderMut = useResponderRfi();
  const cerrarMut = useCerrarRfi();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<RfiCreateInput>({
    resolver: zodResolver(zRfiCreate),
    defaultValues: { proyectoId: '', titulo: '', descripcion: '', impacto: 'NINGUNO' },
  });

  async function onSubmit(values: RfiCreateInput) {
    try {
      await crearMut.mutateAsync(values);
      toast.success('RFI creada');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error creando RFI');
    }
  }

  async function handleResponder() {
    if (!selected || !respuesta.trim()) return;
    try {
      await responderMut.mutateAsync({ id: selected.id, input: { respuesta } });
      toast.success('RFI respondida');
      setSelected(null);
      setRespuesta('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error respondiendo RFI');
    }
  }

  async function handleCerrar() {
    if (!selected) return;
    try {
      await cerrarMut.mutateAsync(selected.id);
      toast.success('RFI cerrada');
      setSelected(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error cerrando RFI');
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">RFI — Solicitudes de información</h1>
          <p className="text-sm text-gray-500 mt-0.5">Solicitudes de aclaración de diseño o especificaciones</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Nueva RFI
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
      {error && <ErrorState message="Error cargando RFIs" onRetry={() => refetch()} />}
      {!isLoading && !error && (
        rfis.length === 0
          ? <EmptyState title="Sin RFIs" description="Las solicitudes de información al diseñador aparecerán aquí." action={<Button size="sm" onClick={() => setShowForm(true)}>Nueva RFI</Button>} />
          : <DataTable columns={columns} data={rfis} searchColumn="titulo" searchPlaceholder="Buscar RFI…" onRowClick={setSelected} />
      )}

      {/* Detalle RFI */}
      {selected && (
        <Modal open={!!selected} onClose={() => { setSelected(null); setRespuesta(''); }} title={selected.titulo} size="lg">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={ESTADO_BADGE[selected.estado] ?? 'default'}>
                {ESTADO_LABEL[selected.estado] ?? selected.estado}
              </Badge>
              <span className="text-xs text-gray-500">{IMPACTO_LABEL[selected.impacto]}</span>
              {selected.impactoDias && (
                <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                  +{selected.impactoDias} días
                </span>
              )}
            </div>

            <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{selected.descripcion}</p>

            {selected.respuesta && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <MessageSquare size={13} className="text-green-600" />
                  <span className="text-xs font-semibold text-green-700">Respuesta</span>
                </div>
                <p className="text-sm text-green-800">{selected.respuesta}</p>
              </div>
            )}

            {selected.estado === 'ABIERTA' && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Responder RFI</label>
                <textarea
                  value={respuesta}
                  onChange={(e) => setRespuesta(e.target.value)}
                  rows={3}
                  placeholder="Escribe la respuesta técnica o aclaración…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              {selected.estado === 'ABIERTA' && (
                <Button onClick={handleResponder} disabled={!respuesta.trim() || responderMut.isPending} size="sm">
                  <MessageSquare size={13} className="mr-1.5" />
                  {responderMut.isPending ? 'Guardando…' : 'Guardar respuesta'}
                </Button>
              )}
              {selected.estado === 'RESPONDIDA' && (
                <Button onClick={handleCerrar} disabled={cerrarMut.isPending} size="sm">
                  <CheckCircle size={13} className="mr-1.5" />
                  {cerrarMut.isPending ? 'Cerrando…' : 'Cerrar RFI'}
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Nueva RFI */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nueva RFI" size="md">
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
          <FormField label="Título" required error={errors.titulo?.message}>
            <Input {...register('titulo')} placeholder="Descripción breve de la solicitud…" />
          </FormField>
          <FormField label="Descripción detallada" required error={errors.descripcion?.message}>
            <textarea
              {...register('descripcion')}
              rows={3}
              placeholder="Detalla la aclaración o información que necesitas del diseñador…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Impacto" error={errors.impacto?.message}>
              <select
                {...register('impacto')}
                className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {IMPACTOS_RFI.map((i) => <option key={i} value={i}>{IMPACTO_LABEL[i]}</option>)}
              </select>
            </FormField>
            <FormField label="Fecha límite">
              <Input type="date" {...register('fechaLimite')} />
            </FormField>
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            {crearMut.isPending ? 'Creando…' : 'Crear RFI'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
