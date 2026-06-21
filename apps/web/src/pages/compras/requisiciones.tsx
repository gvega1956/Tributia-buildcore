import { useState } from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, Send } from 'lucide-react';
import { zRequisicionCreate, type RequisicionCreateInput } from '@tributia/compras';
import {
  useRequisiciones,
  useCreateRequisicion,
  useSubmitRequisicion,
  type Requisicion,
} from '@/hooks/use-compras';
import { useProyectos } from '@/hooks/use-proyectos';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';

const ESTADO_BADGE: Record<string, 'default' | 'warning' | 'success' | 'info'> = {
  BORRADOR: 'default',
  ENVIADA: 'warning',
  PROCESADA: 'success',
};

const ESTADO_LABELS: Record<string, string> = {
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  PROCESADA: 'Procesada',
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

const columns: ColumnDef<Requisicion>[] = [
  {
    accessorKey: 'id',
    header: 'ID',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-gray-500">{row.original.id.slice(0, 8)}…</span>
    ),
  },
  {
    accessorKey: 'proyectoId',
    header: 'Proyecto',
    cell: ({ row }) => (
      <span className="font-mono text-xs text-gray-500">{row.original.proyectoId.slice(0, 8)}…</span>
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
    accessorKey: 'fechaRequerida',
    header: 'Fecha requerida',
    cell: ({ row }) => row.original.fechaRequerida ?? '—',
  },
  {
    accessorKey: 'createdAt',
    header: 'Creada',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('es-DO'),
  },
];

export function RequisicionesPage() {
  const [showForm, setShowForm] = useState(false);
  const [proyectoFiltro, setProyectoFiltro] = useState('');

  const { data: requisiciones = [], isLoading, error, refetch } = useRequisiciones(proyectoFiltro || undefined);
  const { data: proyectos = [] } = useProyectos();
  const crearMut = useCreateRequisicion();
  const submitMut = useSubmitRequisicion();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<RequisicionCreateInput>({
    resolver: zodResolver(zRequisicionCreate),
    defaultValues: {
      empresaId: '',
      proyectoId: '',
      lineas: [{ partidaId: '', descripcion: '', cantidad: '1.0000', unidadMedida: 'UND', precioEstimado: '0.0000', moneda: 'DOP' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });

  async function onSubmit(values: RequisicionCreateInput) {
    try {
      await crearMut.mutateAsync(values);
      toast.success('Requisición creada');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error creando requisición');
    }
  }

  async function handleSubmitReq(id: string) {
    try {
      await submitMut.mutateAsync(id);
      toast.success('Requisición enviada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error enviando requisición');
    }
  }

  const proyectoActivo = proyectos[0]; // primer proyecto disponible como default

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Requisiciones</h1>
          <p className="text-sm text-gray-500 mt-0.5">Solicitudes internas de materiales</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Nueva Requisición
        </Button>
      </div>

      {/* Filtro por proyecto */}
      <div className="flex gap-3 items-center">
        <label className="text-sm font-medium text-gray-600 shrink-0">Filtrar proyecto:</label>
        <select
          value={proyectoFiltro}
          onChange={(e) => setProyectoFiltro(e.target.value)}
          className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Todos</option>
          {proyectos.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando requisiciones" onRetry={() => refetch()} />}

      {!isLoading && !error && (
        <>
          {requisiciones.length === 0 ? (
            <EmptyState
              title="Sin requisiciones"
              description="Crea la primera solicitud de materiales para este proyecto."
              action={<Button size="sm" onClick={() => setShowForm(true)}>Nueva Requisición</Button>}
            />
          ) : (
            <DataTable
              columns={[
                ...columns,
                {
                  id: 'acciones',
                  header: '',
                  cell: ({ row }) => row.original.estado === 'BORRADOR' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => { e.stopPropagation(); handleSubmitReq(row.original.id); }}
                      disabled={submitMut.isPending}
                    >
                      <Send size={12} className="mr-1" />
                      Enviar
                    </Button>
                  ) : null,
                },
              ]}
              data={requisiciones}
              searchColumn="proyectoId"
              searchPlaceholder="Buscar por proyecto…"
            />
          )}
        </>
      )}

      {/* Modal: Nueva Requisición */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nueva Requisición" size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Proyecto" required error={errors.proyectoId?.message}>
              <select
                {...register('proyectoId')}
                defaultValue={proyectoActivo?.id ?? ''}
                className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">Seleccionar proyecto…</option>
                {proyectos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </FormField>

            <FormField label="Empresa" required error={errors.empresaId?.message}>
              <select
                {...register('empresaId')}
                className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">Seleccionar empresa…</option>
                {/* empresas disponibles vía proyecto seleccionado */}
                {proyectoActivo && (
                  <option value={proyectoActivo.empresaId}>{proyectoActivo.empresaId.slice(0, 8)}…</option>
                )}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Fecha requerida" error={errors.fechaRequerida?.message}>
              <Input type="date" {...register('fechaRequerida')} />
            </FormField>
            <FormField label="Notas" error={errors.notas?.message}>
              <Input {...register('notas')} placeholder="Observaciones opcionales" />
            </FormField>
          </div>

          {/* Líneas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Líneas <span className="text-red-500">*</span></label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => append({ partidaId: '', descripcion: '', cantidad: '1.0000', unidadMedida: 'UND', precioEstimado: '0.0000', moneda: 'DOP' })}
              >
                <Plus size={12} className="mr-1" />
                Agregar línea
              </Button>
            </div>
            <div className="space-y-2">
              {fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-[1fr_2fr_1fr_1fr_auto] gap-2 items-start p-3 bg-gray-50 rounded-lg">
                  <div>
                    <Input
                      {...register(`lineas.${i}.partidaId`)}
                      placeholder="ID Partida"
                      className="text-xs"
                    />
                    {errors.lineas?.[i]?.partidaId && (
                      <p className="text-xs text-red-500 mt-0.5">{errors.lineas[i]?.partidaId?.message}</p>
                    )}
                  </div>
                  <div>
                    <Input
                      {...register(`lineas.${i}.descripcion`)}
                      placeholder="Descripción del material"
                      className="text-xs"
                    />
                    {errors.lineas?.[i]?.descripcion && (
                      <p className="text-xs text-red-500 mt-0.5">{errors.lineas[i]?.descripcion?.message}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Input
                      {...register(`lineas.${i}.cantidad`)}
                      placeholder="Cant."
                      className="text-xs w-20"
                    />
                    <Input
                      {...register(`lineas.${i}.unidadMedida`)}
                      placeholder="UND"
                      className="text-xs w-16"
                    />
                  </div>
                  <div>
                    <Controller
                      control={control}
                      name={`lineas.${i}.precioEstimado`}
                      render={({ field: f }) => (
                        <Input
                          {...f}
                          placeholder="Precio est."
                          className="text-xs"
                        />
                      )}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => fields.length > 1 && remove(i)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Eliminar línea"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            {errors.lineas?.root && (
              <p className="text-xs text-red-600 mt-1">{errors.lineas.root.message}</p>
            )}
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            {crearMut.isPending ? 'Guardando…' : 'Crear Requisición'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
