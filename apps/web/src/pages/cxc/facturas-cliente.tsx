import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Send, FileDown } from 'lucide-react';
import { zFacturaClienteCreate, type FacturaClienteCreateInput } from '@tributia/cxc';
import { useFacturasCliente, useEmitirFactura, type FacturaCliente } from '@/hooks/use-cxc';
import { useProyectos } from '@/hooks/use-proyectos';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import Decimal from 'decimal.js';
import { useDescargarFacturaClientePdf } from '@/hooks/use-documentos-pdf';

const ESTADO_BADGE: Record<string, 'default' | 'info' | 'success' | 'danger'> = {
  EMITIDA: 'info',
  COBRADA: 'success',
  ANULADA: 'danger',
};

const columns: ColumnDef<FacturaCliente>[] = [
  {
    accessorKey: 'numero',
    header: 'N° Factura',
    cell: ({ row }) => <span className="font-mono font-semibold text-gray-900">{row.original.numero}</span>,
  },
  {
    accessorKey: 'ncf',
    header: 'NCF',
    cell: ({ row }) => row.original.ncf
      ? <span className="font-mono text-xs text-gray-600">{row.original.ncf}</span>
      : <span className="text-gray-300 text-xs">Sin NCF</span>,
  },
  {
    accessorKey: 'total',
    header: 'Total',
    cell: ({ row }) => (
      <span className="tabular-nums font-semibold">
        {new Decimal(row.original.total).toFixed(2)} {row.original.moneda}
      </span>
    ),
  },
  {
    accessorKey: 'itbis',
    header: 'ITBIS',
    cell: ({ row }) => <span className="tabular-nums text-sm">{new Decimal(row.original.itbis).toFixed(2)}</span>,
  },
  {
    accessorKey: 'fechaVencimiento',
    header: 'Vencimiento',
    cell: ({ row }) => {
      const vencida = new Date(row.original.fechaVencimiento) < new Date();
      return (
        <span className={vencida && row.original.estado === 'EMITIDA' ? 'text-red-600 font-medium' : ''}>
          {row.original.fechaVencimiento}
        </span>
      );
    },
  },
  {
    accessorKey: 'estado',
    header: 'Estado',
    cell: ({ row }) => (
      <Badge variant={ESTADO_BADGE[row.original.estado] ?? 'default'}>{row.original.estado}</Badge>
    ),
  },
];

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

export function FacturasClientePage() {
  const [showForm, setShowForm] = useState(false);
  const [proyectoFiltro, setProyectoFiltro] = useState('');
  const [selected, setSelected] = useState<FacturaCliente | null>(null);

  const { data: facturas = [], isLoading, error, refetch } = useFacturasCliente(proyectoFiltro || undefined);
  const { data: proyectos = [] } = useProyectos();
  const emitirMut = useEmitirFactura();
  const pdfMut    = useDescargarFacturaClientePdf();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FacturaClienteCreateInput>({
    resolver: zodResolver(zFacturaClienteCreate),
    defaultValues: { cubicacionId: '', clienteId: '', numero: '', itbisPct: '18', diasCredito: 30 },
  });

  async function onSubmit(values: FacturaClienteCreateInput) {
    try {
      // Acción financiera — espera confirmación del servidor antes de reportar éxito
      await emitirMut.mutateAsync(values);
      toast.success('Factura emitida');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error emitiendo factura');
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Facturas al Cliente</h1>
          <p className="text-sm text-gray-500 mt-0.5">Emitidas desde cubicaciones — calcula ITBIS y retenciones automáticamente</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Emitir factura
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
      {error && <ErrorState message="Error cargando facturas" onRetry={() => refetch()} />}
      {!isLoading && !error && (
        facturas.length === 0
          ? <EmptyState title="Sin facturas" description="Emite facturas al cliente desde cubicaciones certificadas." action={<Button size="sm" onClick={() => setShowForm(true)}>Emitir factura</Button>} />
          : <DataTable columns={columns} data={facturas} searchColumn="numero" searchPlaceholder="Buscar factura…" onRowClick={setSelected} />
      )}

      {/* Detalle */}
      {selected && (
        <Modal open onClose={() => setSelected(null)} title={`Factura ${selected.numero}`} size="md">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={ESTADO_BADGE[selected.estado] ?? 'default'}>{selected.estado}</Badge>
              {selected.ncf && <span className="text-xs font-mono text-gray-500">{selected.ncf}</span>}
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal:</span><span className="tabular-nums">{new Decimal(selected.subtotal).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">ITBIS:</span><span className="tabular-nums">{new Decimal(selected.itbis).toFixed(2)}</span></div>
              {selected.retenciones.map((r, i) => (
                <div key={i} className="flex justify-between text-amber-700">
                  <span>Ret. {r.concepto} ({r.porcentaje}%):</span>
                  <span className="tabular-nums">({new Decimal(r.monto).toFixed(2)})</span>
                </div>
              ))}
              <div className="flex justify-between font-bold border-t border-gray-200 pt-1.5 text-base">
                <span>Total:</span>
                <span className="tabular-nums">{new Decimal(selected.total).toFixed(2)} {selected.moneda}</span>
              </div>
            </div>
            <p className="text-xs text-gray-400">Vence: {selected.fechaVencimiento}</p>
            {/* e-CF: gap de backend para integración con middleware DGII */}
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              <span className="font-semibold">e-CF:</span> La emisión fiscal requiere conexión con el middleware DGII — pendiente de configuración. Ver endpoint <span className="font-mono">/api/v1/localizacion-do/emitir</span>.
            </div>
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cerrar</Button>
            <Button
              variant="outline"
              aria-label="Descargar PDF factura"
              onClick={() => void pdfMut.descargar(selected.id)}
              disabled={pdfMut.isPending}
            >
              <FileDown size={14} className="mr-1.5" />
              {pdfMut.isPending ? 'Generando…' : 'Descargar PDF'}
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Formulario emitir */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Emitir Factura al Cliente" size="md">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Cubicación" required error={errors.cubicacionId?.message}>
            <Input {...register('cubicacionId')} placeholder="UUID de la cubicación EMITIDA" />
          </FormField>
          <FormField label="Cliente" required error={errors.clienteId?.message}>
            <Input {...register('clienteId')} placeholder="UUID del tercero (cliente)" />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Número de factura" required error={errors.numero?.message}>
              <Input {...register('numero')} placeholder="B01-00000001" />
            </FormField>
            <FormField label="NCF (opcional)">
              <Input {...register('ncf')} placeholder="B0100000001" />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="ITBIS %">
              <Input {...register('itbisPct')} placeholder="18" />
            </FormField>
            <FormField label="Días de crédito">
              <Input type="number" {...register('diasCredito', { valueAsNumber: true })} placeholder="30" />
            </FormField>
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={emitirMut.isPending}>
            <Send size={14} className="mr-1.5" />
            {emitirMut.isPending ? 'Emitiendo…' : 'Emitir factura'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
