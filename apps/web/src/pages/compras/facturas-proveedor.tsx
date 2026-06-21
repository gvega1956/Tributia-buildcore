import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import { zFacturaProveedorCreate, type FacturaProveedorCreateInput } from '@tributia/compras';
import {
  useFacturasProveedor,
  useCreateFactura,
  type FacturaProveedor,
  type EstadoMatch,
} from '@/hooks/use-compras';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';

const ESTADO_BADGE: Record<string, 'default' | 'warning' | 'success' | 'danger' | 'info'> = {
  PENDIENTE_VALIDACION: 'warning',
  VALIDADA: 'success',
  CON_DISCREPANCIAS: 'danger',
  APROBADA_EXCEPCION: 'info',
};

const ESTADO_LABELS: Record<string, string> = {
  PENDIENTE_VALIDACION: 'Pend. validación',
  VALIDADA: 'Validada',
  CON_DISCREPANCIAS: 'Con discrepancias',
  APROBADA_EXCEPCION: 'Aprobada (excepción)',
};

const MATCH_BADGE: Record<EstadoMatch, 'success' | 'danger' | 'warning' | 'default'> = {
  OK: 'success',
  PRECIO_DISCREPANTE: 'danger',
  CANTIDAD_DISCREPANTE: 'danger',
  AMBOS_DISCREPANTES: 'danger',
  SIN_OC: 'warning',
};

const MATCH_LABELS: Record<EstadoMatch, string> = {
  OK: '3 vías OK',
  PRECIO_DISCREPANTE: 'Precio diferente',
  CANTIDAD_DISCREPANTE: 'Cantidad diferente',
  AMBOS_DISCREPANTES: 'Precio y cantidad',
  SIN_OC: 'Sin OC ref.',
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

function MatchIndicator({ estado }: { estado: EstadoMatch | null }) {
  if (!estado) return <span className="text-gray-400 text-xs">—</span>;
  const isOk = estado === 'OK';
  return (
    <div className="flex items-center gap-1.5">
      {isOk
        ? <CheckCircle size={14} className="text-green-500" />
        : <AlertTriangle size={14} className="text-red-500" />}
      <Badge variant={MATCH_BADGE[estado]}>{MATCH_LABELS[estado]}</Badge>
    </div>
  );
}

export function FacturasProveedorPage() {
  const [showForm, setShowForm] = useState(false);

  const { data: facturas = [], isLoading, error, refetch } = useFacturasProveedor();
  const crearMut = useCreateFactura();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<FacturaProveedorCreateInput>({
    resolver: zodResolver(zFacturaProveedorCreate),
    defaultValues: {
      empresaId: '',
      terceroId: '',
      rncProveedor: '',
      numero: '',
      ncf: '',
      fechaFactura: '',
      montoSubtotal: '0.0000',
      montoItbis: '0.0000',
      montoTotal: '0.0000',
      moneda: 'DOP',
      lineas: [{
        descripcion: '', cantidad: '1.0000',
        precioUnitario: '0.0000', total: '0.0000', moneda: 'DOP',
      }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });

  async function onSubmit(values: FacturaProveedorCreateInput) {
    try {
      await crearMut.mutateAsync(values);
      toast.success('Factura registrada y match 3 vías ejecutado');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error registrando factura');
    }
  }

  const columns: ColumnDef<FacturaProveedor>[] = [
    {
      accessorKey: 'numero',
      header: 'Número',
      cell: ({ row }) => <span className="font-medium text-gray-900">{row.original.numero}</span>,
    },
    {
      accessorKey: 'ncf',
      header: 'NCF',
      cell: ({ row }) => <span className="font-mono text-xs text-gray-600">{row.original.ncf}</span>,
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
      accessorKey: 'estadoMatch',
      header: 'Match 3 vías',
      cell: ({ row }) => <MatchIndicator estado={row.original.estadoMatch} />,
    },
    {
      accessorKey: 'montoTotal',
      header: 'Total',
      cell: ({ row }) => (
        <span className="tabular-nums font-medium">
          {row.original.moneda} {parseFloat(row.original.montoTotal).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      accessorKey: 'fechaFactura',
      header: 'Fecha',
      cell: ({ row }) => row.original.fechaFactura,
    },
  ];

  const discrepantes = facturas.filter(
    (f) => f.estadoMatch && f.estadoMatch !== 'OK' && f.estadoMatch !== 'SIN_OC',
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Facturas de Proveedor</h1>
          <p className="text-sm text-gray-500 mt-0.5">Registro y validación match 3 vías (OC → Recepción → Factura)</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Registrar Factura
        </Button>
      </div>

      {/* Alerta de discrepancias */}
      {discrepantes.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">
              {discrepantes.length} factura{discrepantes.length > 1 ? 's' : ''} con discrepancias en match 3 vías
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Revisar diferencias de precio o cantidad antes de autorizar el pago.
            </p>
          </div>
        </div>
      )}

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando facturas" onRetry={() => refetch()} />}

      {!isLoading && !error && (
        <>
          {facturas.length === 0 ? (
            <EmptyState
              title="Sin facturas registradas"
              description="Registra la factura del proveedor después de recibir los materiales."
              action={<Button size="sm" onClick={() => setShowForm(true)}>Registrar Factura</Button>}
            />
          ) : (
            <DataTable
              columns={columns}
              data={facturas}
              searchColumn="numero"
              searchPlaceholder="Buscar por número…"
            />
          )}
        </>
      )}

      {/* Modal: Registrar Factura */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Registrar Factura de Proveedor" size="xl">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Empresa" required error={errors.empresaId?.message}>
              <Input {...register('empresaId')} placeholder="UUID empresa" />
            </FormField>
            <FormField label="Proveedor" required error={errors.terceroId?.message}>
              <Input {...register('terceroId')} placeholder="UUID proveedor" />
            </FormField>
            <FormField label="RNC Proveedor" required error={errors.rncProveedor?.message}>
              <Input {...register('rncProveedor')} placeholder="9-13 dígitos" />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="OC (opcional)" error={errors.ordenCompraId?.message}>
              <Input {...register('ordenCompraId')} placeholder="UUID orden de compra" />
            </FormField>
            <FormField label="Recepción (opcional)" error={errors.recepcionOcId?.message}>
              <Input {...register('recepcionOcId')} placeholder="UUID recepción" />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <FormField label="Número factura" required error={errors.numero?.message}>
              <Input {...register('numero')} placeholder="Núm. interno" />
            </FormField>
            <FormField label="NCF" required error={errors.ncf?.message}>
              <Input {...register('ncf')} placeholder="B0100000001" />
            </FormField>
            <FormField label="Fecha factura" required error={errors.fechaFactura?.message}>
              <Input type="date" {...register('fechaFactura')} />
            </FormField>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <FormField label="Subtotal" required error={errors.montoSubtotal?.message}>
              <Input {...register('montoSubtotal')} placeholder="0.0000" />
            </FormField>
            <FormField label="ITBIS" required error={errors.montoItbis?.message}>
              <Input {...register('montoItbis')} placeholder="0.0000" />
            </FormField>
            <FormField label="Total" required error={errors.montoTotal?.message}>
              <Input {...register('montoTotal')} placeholder="0.0000" />
            </FormField>
            <FormField label="Moneda">
              <select
                {...register('moneda')}
                className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="DOP">DOP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </FormField>
          </div>

          <FormField label="Fecha vencimiento pago">
            <Input type="date" {...register('fechaVencimientoPago')} />
          </FormField>

          {/* Líneas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Líneas <span className="text-red-500">*</span></label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => append({
                  descripcion: '', cantidad: '1.0000',
                  precioUnitario: '0.0000', total: '0.0000', moneda: 'DOP',
                })}
              >
                <Plus size={12} className="mr-1" />
                Agregar
              </Button>
            </div>
            <div className="space-y-2">
              {fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-start p-3 bg-gray-50 rounded-lg">
                  <Input {...register(`lineas.${i}.descripcion`)} placeholder="Descripción" className="text-xs" />
                  <Input {...register(`lineas.${i}.cantidad`)} placeholder="Cant." className="text-xs" />
                  <Input {...register(`lineas.${i}.precioUnitario`)} placeholder="Precio U." className="text-xs" />
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
            <Input {...register('notas')} placeholder="Observaciones" />
          </FormField>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            {crearMut.isPending ? 'Guardando…' : 'Registrar Factura'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
