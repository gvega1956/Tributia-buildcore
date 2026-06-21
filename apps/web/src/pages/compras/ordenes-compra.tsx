import { useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, CheckCircle, Zap } from 'lucide-react';
import { zOrdenCompraCreate, type OrdenCompraCreateInput } from '@tributia/compras';
import {
  useOrdenesCompra,
  useCreateOrdenCompra,
  useAprobarOrdenCompra,
  useEmitirOrdenCompra,
  type OrdenCompra,
  type EstadoOrdenCompra,
} from '@/hooks/use-compras';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';

const ESTADO_BADGE: Record<EstadoOrdenCompra, 'default' | 'warning' | 'info' | 'success' | 'danger'> = {
  BORRADOR: 'default',
  PENDIENTE_APROBACION: 'warning',
  APROBADA: 'info',
  EMITIDA: 'success',
  RECIBIDA_PARCIAL: 'info',
  RECIBIDA_TOTAL: 'success',
  CANCELADA: 'danger',
};

const ESTADO_LABELS: Record<EstadoOrdenCompra, string> = {
  BORRADOR: 'Borrador',
  PENDIENTE_APROBACION: 'Pend. aprobación',
  APROBADA: 'Aprobada',
  EMITIDA: 'Emitida',
  RECIBIDA_PARCIAL: 'Rec. parcial',
  RECIBIDA_TOTAL: 'Rec. total',
  CANCELADA: 'Cancelada',
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

export function OrdenesCompraPage() {
  const [showForm, setShowForm] = useState(false);

  const { data: ordenes = [], isLoading, error, refetch } = useOrdenesCompra();
  const crearMut = useCreateOrdenCompra();
  const aprobarMut = useAprobarOrdenCompra();
  const emitirMut = useEmitirOrdenCompra();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<OrdenCompraCreateInput>({
    resolver: zodResolver(zOrdenCompraCreate),
    defaultValues: {
      empresaId: '',
      terceroId: '',
      lineas: [{
        partidaId: '', descripcion: '', cantidad: '1.0000',
        unidadMedida: 'UND', precioUnitario: '0.0000', total: '0.0000', moneda: 'DOP',
      }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });

  async function onSubmit(values: OrdenCompraCreateInput) {
    try {
      await crearMut.mutateAsync(values);
      toast.success('Orden de compra creada');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error creando OC');
    }
  }

  async function handleAprobar(id: string) {
    try {
      await aprobarMut.mutateAsync(id);
      toast.success('OC aprobada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error aprobando OC');
    }
  }

  async function handleEmitir(id: string) {
    try {
      await emitirMut.mutateAsync(id);
      toast.success('OC emitida al proveedor');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error emitiendo OC');
    }
  }

  const columns: ColumnDef<OrdenCompra>[] = [
    {
      accessorKey: 'id',
      header: 'OC',
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
      accessorKey: 'fechaEntregaPrometida',
      header: 'Entrega prometida',
      cell: ({ row }) => row.original.fechaEntregaPrometida ?? '—',
    },
    {
      accessorKey: 'createdAt',
      header: 'Creada',
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('es-DO'),
    },
    {
      id: 'acciones',
      header: '',
      cell: ({ row }) => {
        const oc = row.original;
        return (
          <div className="flex gap-2">
            {oc.estado === 'PENDIENTE_APROBACION' && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); handleAprobar(oc.id); }}
                disabled={aprobarMut.isPending}
              >
                <CheckCircle size={12} className="mr-1 text-green-600" />
                Aprobar
              </Button>
            )}
            {oc.estado === 'APROBADA' && (
              <Button
                size="sm"
                onClick={(e) => { e.stopPropagation(); handleEmitir(oc.id); }}
                disabled={emitirMut.isPending}
              >
                <Zap size={12} className="mr-1" />
                Emitir
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Órdenes de Compra</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestión completa del flujo de aprobación y emisión</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Nueva OC
        </Button>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando órdenes de compra" onRetry={() => refetch()} />}

      {!isLoading && !error && (
        <>
          {ordenes.length === 0 ? (
            <EmptyState
              title="Sin órdenes de compra"
              description="Crea una OC directa o selecciona una cotización ganadora."
              action={<Button size="sm" onClick={() => setShowForm(true)}>Nueva OC</Button>}
            />
          ) : (
            <DataTable columns={columns} data={ordenes} searchPlaceholder="Buscar OC…" />
          )}
        </>
      )}

      {/* Modal: Nueva OC */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nueva Orden de Compra" size="xl">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Empresa" required error={errors.empresaId?.message}>
              <Input {...register('empresaId')} placeholder="UUID empresa" />
            </FormField>
            <FormField label="Proveedor (terceroId)" required error={errors.terceroId?.message}>
              <Input {...register('terceroId')} placeholder="UUID proveedor" />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <FormField label="Cotización (opcional)" error={errors.cotizacionId?.message}>
              <Input {...register('cotizacionId')} placeholder="UUID cotización" />
            </FormField>
            <FormField label="Fecha emisión">
              <Input type="date" {...register('fechaEmision')} />
            </FormField>
            <FormField label="Entrega prometida">
              <Input type="date" {...register('fechaEntregaPrometida')} />
            </FormField>
          </div>

          <FormField label="Condiciones de pago">
            <Input {...register('condicionesPago')} placeholder="Ej: 30 días crédito" />
          </FormField>

          {/* Líneas OC */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Líneas <span className="text-red-500">*</span></label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => append({
                  partidaId: '', descripcion: '', cantidad: '1.0000',
                  unidadMedida: 'UND', precioUnitario: '0.0000', total: '0.0000', moneda: 'DOP',
                })}
              >
                <Plus size={12} className="mr-1" />
                Agregar
              </Button>
            </div>

            <div className="space-y-2">
              {fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-[1fr_2fr_1fr_1fr_1fr_auto] gap-2 items-start p-3 bg-gray-50 rounded-lg">
                  <div>
                    <Input {...register(`lineas.${i}.partidaId`)} placeholder="Partida ID" className="text-xs" />
                  </div>
                  <div>
                    <Input {...register(`lineas.${i}.descripcion`)} placeholder="Descripción" className="text-xs" />
                  </div>
                  <div className="flex gap-1">
                    <Input {...register(`lineas.${i}.cantidad`)} placeholder="Cant." className="text-xs w-16" />
                    <Input {...register(`lineas.${i}.unidadMedida`)} placeholder="UND" className="text-xs w-14" />
                  </div>
                  <Input {...register(`lineas.${i}.precioUnitario`)} placeholder="P.U." className="text-xs" />
                  <Input {...register(`lineas.${i}.total`)} placeholder="Total" className="text-xs" />
                  <button
                    type="button"
                    onClick={() => fields.length > 1 && remove(i)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <FormField label="Notas">
            <Input {...register('notas')} placeholder="Observaciones opcionales" />
          </FormField>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            {crearMut.isPending ? 'Guardando…' : 'Crear OC'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
