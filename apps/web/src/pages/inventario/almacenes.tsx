import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Package } from 'lucide-react';
import { zAlmacenCreate, TIPOS_ALMACEN, type AlmacenCreateInput } from '@tributia/inventario';
import { useAlmacenes, useCreateAlmacen, type Almacen, type TipoAlmacen } from '@/hooks/use-inventario';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';

const TIPO_BADGE: Record<TipoAlmacen, 'default' | 'info' | 'warning'> = {
  CENTRAL: 'info',
  OBRA: 'default',
  TRANSITO: 'warning',
};

const TIPO_LABELS: Record<TipoAlmacen, string> = {
  CENTRAL: 'Central',
  OBRA: 'Obra',
  TRANSITO: 'Tránsito',
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

const columns: ColumnDef<Almacen>[] = [
  {
    accessorKey: 'codigo',
    header: 'Código',
    cell: ({ row }) => <span className="font-mono text-sm font-medium text-gray-900">{row.original.codigo}</span>,
  },
  {
    accessorKey: 'nombre',
    header: 'Nombre',
    cell: ({ row }) => <span className="text-gray-900">{row.original.nombre}</span>,
  },
  {
    accessorKey: 'tipo',
    header: 'Tipo',
    cell: ({ row }) => (
      <Badge variant={TIPO_BADGE[row.original.tipo]}>
        {TIPO_LABELS[row.original.tipo]}
      </Badge>
    ),
  },
  {
    accessorKey: 'ubicacionFisica',
    header: 'Ubicación',
    cell: ({ row }) => row.original.ubicacionFisica ?? '—',
  },
  {
    accessorKey: 'activo',
    header: 'Estado',
    cell: ({ row }) => (
      <Badge variant={row.original.activo ? 'success' : 'default'}>
        {row.original.activo ? 'Activo' : 'Inactivo'}
      </Badge>
    ),
  },
];

export function AlmacenesPage() {
  const [showForm, setShowForm] = useState(false);

  const { data: almacenes = [], isLoading, error, refetch } = useAlmacenes();
  const crearMut = useCreateAlmacen();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<AlmacenCreateInput>({
    resolver: zodResolver(zAlmacenCreate),
    defaultValues: {
      empresaId: '',
      tipo: 'CENTRAL',
      codigo: '',
      nombre: '',
    },
  });

  async function onSubmit(values: AlmacenCreateInput) {
    try {
      await crearMut.mutateAsync(values);
      toast.success('Almacén creado');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error creando almacén');
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Almacenes</h1>
          <p className="text-sm text-gray-500 mt-0.5">Central, obra y tránsito</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Nuevo Almacén
        </Button>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando almacenes" onRetry={() => refetch()} />}

      {!isLoading && !error && (
        <>
          {almacenes.length === 0 ? (
            <EmptyState
              title="Sin almacenes"
              description="Crea el primer almacén para comenzar a gestionar inventario."
              icon={<Package size={48} />}
              action={<Button size="sm" onClick={() => setShowForm(true)}>Nuevo Almacén</Button>}
            />
          ) : (
            <DataTable
              columns={columns}
              data={almacenes}
              searchColumn="nombre"
              searchPlaceholder="Buscar almacén…"
            />
          )}
        </>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nuevo Almacén" size="md">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Empresa" required error={errors.empresaId?.message}>
            <Input {...register('empresaId')} placeholder="UUID empresa" />
          </FormField>

          <FormField label="Proyecto (opcional)" error={errors.proyectoId?.message}>
            <Input {...register('proyectoId')} placeholder="UUID proyecto (solo para tipo OBRA)" />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Tipo" required error={errors.tipo?.message}>
              <select
                {...register('tipo')}
                className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {TIPOS_ALMACEN.map((t) => (
                  <option key={t} value={t}>{TIPO_LABELS[t]}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Código" required error={errors.codigo?.message}>
              <Input {...register('codigo')} placeholder="ALM-001" />
            </FormField>
          </div>

          <FormField label="Nombre" required error={errors.nombre?.message}>
            <Input {...register('nombre')} placeholder="Almacén Central Proyecto X" />
          </FormField>

          <FormField label="Ubicación física" error={errors.ubicacionFisica?.message}>
            <Input {...register('ubicacionFisica')} placeholder="Av. 27 de Febrero #123, SDO" />
          </FormField>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            {crearMut.isPending ? 'Guardando…' : 'Crear Almacén'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
