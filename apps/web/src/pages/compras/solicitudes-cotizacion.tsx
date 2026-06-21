import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Send, Eye } from 'lucide-react';
import { zSocCreate, type SocCreateInput } from '@tributia/compras';
import {
  useSolicitudesCotizacion,
  useCreateSoc,
  useEnviarSoc,
  useCotizaciones,
  useSeleccionarCotizacion,
  type SolicitudCotizacion,
} from '@/hooks/use-compras';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';

const ESTADO_BADGE: Record<string, 'default' | 'warning' | 'success'> = {
  BORRADOR: 'default',
  ENVIADA: 'warning',
  CERRADA: 'success',
};

const ESTADO_LABELS: Record<string, string> = {
  BORRADOR: 'Borrador',
  ENVIADA: 'Enviada',
  CERRADA: 'Cerrada',
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

export function SolicitudesCotizacionPage() {
  const [showForm, setShowForm] = useState(false);
  const [selectedSoc, setSelectedSoc] = useState<SolicitudCotizacion | null>(null);

  const { data: socs = [], isLoading, error, refetch } = useSolicitudesCotizacion();
  const { data: cotizaciones = [] } = useCotizaciones(selectedSoc?.id);
  const crearMut = useCreateSoc();
  const enviarMut = useEnviarSoc();
  const seleccionarMut = useSeleccionarCotizacion();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<SocCreateInput>({
    resolver: zodResolver(zSocCreate),
    defaultValues: { empresaId: '', lineaRequisicionIds: [], terceroIds: [] },
  });

  async function onSubmit(values: SocCreateInput) {
    try {
      await crearMut.mutateAsync(values);
      toast.success('SOC creada');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error creando SOC');
    }
  }

  async function handleEnviar(id: string) {
    try {
      await enviarMut.mutateAsync(id);
      toast.success('SOC enviada a proveedores');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error enviando SOC');
    }
  }

  async function handleSeleccionar(cotizacionId: string) {
    try {
      await seleccionarMut.mutateAsync(cotizacionId);
      toast.success('Cotización seleccionada como ganadora');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error seleccionando cotización');
    }
  }

  const columns: ColumnDef<SolicitudCotizacion>[] = [
    {
      accessorKey: 'id',
      header: 'SOC',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-gray-500">{row.original.id.slice(0, 8)}…</span>
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
      accessorKey: 'fechaVencimiento',
      header: 'Vence',
      cell: ({ row }) => row.original.fechaVencimiento ?? '—',
    },
    {
      accessorKey: 'createdAt',
      header: 'Creada',
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('es-DO'),
    },
    {
      id: 'acciones',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); setSelectedSoc(row.original); }}
          >
            <Eye size={12} className="mr-1" />
            Cotizaciones
          </Button>
          {row.original.estado === 'BORRADOR' && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); handleEnviar(row.original.id); }}
              disabled={enviarMut.isPending}
            >
              <Send size={12} className="mr-1" />
              Enviar
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Solicitudes de Cotización</h1>
          <p className="text-sm text-gray-500 mt-0.5">SOC enviadas a proveedores para comparar precios</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Nueva SOC
        </Button>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando solicitudes" onRetry={() => refetch()} />}

      {!isLoading && !error && (
        <>
          {socs.length === 0 ? (
            <EmptyState
              title="Sin solicitudes de cotización"
              description="Crea una SOC a partir de las líneas de una requisición aprobada."
              action={<Button size="sm" onClick={() => setShowForm(true)}>Nueva SOC</Button>}
            />
          ) : (
            <DataTable columns={columns} data={socs} searchPlaceholder="Buscar SOC…" />
          )}
        </>
      )}

      {/* Modal: Cuadro comparativo de cotizaciones */}
      {selectedSoc && (
        <Modal
          open={!!selectedSoc}
          onClose={() => setSelectedSoc(null)}
          title={`Cotizaciones — SOC ${selectedSoc.id.slice(0, 8)}…`}
          size="lg"
        >
          {cotizaciones.length === 0 ? (
            <EmptyState
              title="Sin cotizaciones recibidas"
              description="Cuando los proveedores respondan la SOC, sus cotizaciones aparecerán aquí."
            />
          ) : (
            <div className="space-y-3">
              {cotizaciones.map((cot) => (
                <div
                  key={cot.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-xl"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-gray-900">
                      Proveedor: <span className="font-mono text-xs text-gray-500">{cot.terceroId.slice(0, 8)}…</span>
                    </p>
                    {cot.numeroCotizacionProveedor && (
                      <p className="text-xs text-gray-500">Ref: {cot.numeroCotizacionProveedor}</p>
                    )}
                    <p className="text-xs text-gray-400">{cot.fechaEmision ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        cot.estado === 'SELECCIONADA' ? 'success' :
                        cot.estado === 'DESCARTADA' ? 'danger' : 'default'
                      }
                    >
                      {cot.estado}
                    </Badge>
                    {cot.estado === 'RECIBIDA' && (
                      <Button
                        size="sm"
                        onClick={() => handleSeleccionar(cot.id)}
                        disabled={seleccionarMut.isPending}
                      >
                        Seleccionar ganadora
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Modal: Nueva SOC */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nueva Solicitud de Cotización" size="md">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Empresa" required error={errors.empresaId?.message}>
            <Input {...register('empresaId')} placeholder="UUID de la empresa" />
          </FormField>

          <FormField label="IDs de líneas de requisición" required error={errors.lineaRequisicionIds?.message}>
            <textarea
              {...register('lineaRequisicionIds', {
                setValueAs: (v: string) =>
                  v.split('\n').map((s) => s.trim()).filter(Boolean),
              })}
              placeholder="Un UUID por línea"
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
            />
          </FormField>

          <FormField label="IDs de proveedores" required error={errors.terceroIds?.message}>
            <textarea
              {...register('terceroIds', {
                setValueAs: (v: string) =>
                  v.split('\n').map((s) => s.trim()).filter(Boolean),
              })}
              placeholder="Un UUID por línea"
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Fecha vencimiento" error={errors.fechaVencimiento?.message}>
              <Input type="date" {...register('fechaVencimiento')} />
            </FormField>
            <FormField label="Notas" error={errors.notas?.message}>
              <Input {...register('notas')} placeholder="Instrucciones opcionales" />
            </FormField>
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            {crearMut.isPending ? 'Guardando…' : 'Crear SOC'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
