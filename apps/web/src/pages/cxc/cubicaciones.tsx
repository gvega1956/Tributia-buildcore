import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, FileCheck, FileDown } from 'lucide-react';
import { zCubicacionCreate, type CubicacionCreateInput } from '@tributia/cxc';
import { useCubicaciones, useCreateCubicacion, type Cubicacion } from '@/hooks/use-cxc';
import { useProyectos } from '@/hooks/use-proyectos';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import Decimal from 'decimal.js';
import { useDescargarCubicacionPdf } from '@/hooks/use-documentos-pdf';

const ESTADO_BADGE: Record<string, 'default' | 'info' | 'success' | 'danger'> = {
  BORRADOR: 'default',
  EMITIDA: 'info',
  ANULADA: 'danger',
};

const columns: ColumnDef<Cubicacion>[] = [
  {
    accessorKey: 'fechaCorte',
    header: 'Corte',
    cell: ({ row }) => <span className="font-medium">{row.original.fechaCorte}</span>,
  },
  {
    id: 'lineas',
    header: 'Partidas',
    cell: ({ row }) => <span className="tabular-nums">{row.original.lineas.length}</span>,
  },
  {
    accessorKey: 'subtotal',
    header: 'Subtotal',
    cell: ({ row }) => (
      <span className="tabular-nums font-semibold">
        {new Decimal(row.original.subtotal).toFixed(2)} {row.original.moneda}
      </span>
    ),
  },
  {
    accessorKey: 'estado',
    header: 'Estado',
    cell: ({ row }) => (
      <Badge variant={ESTADO_BADGE[row.original.estado] ?? 'default'}>{row.original.estado}</Badge>
    ),
  },
  {
    accessorKey: 'createdAt',
    header: 'Creado',
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('es-DO'),
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

export function CubicacionesPage() {
  const [showForm, setShowForm] = useState(false);
  const [proyectoFiltro, setProyectoFiltro] = useState('');
  const [selected, setSelected] = useState<Cubicacion | null>(null);

  const { data: cubicaciones = [], isLoading, error, refetch } = useCubicaciones(proyectoFiltro || undefined);
  const { data: proyectos = [] } = useProyectos();
  const crearMut  = useCreateCubicacion();
  const pdfMut    = useDescargarCubicacionPdf();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<CubicacionCreateInput>({
    resolver: zodResolver(zCubicacionCreate),
    defaultValues: { empresaId: '', proyectoId: '', fechaCorte: new Date().toISOString().slice(0, 10), lineas: [{ partidaId: '', cantidadPeriodo: '0.0000' }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });

  async function onSubmit(values: CubicacionCreateInput) {
    try {
      // Acción financiera — éxito solo tras confirmación del servidor
      await crearMut.mutateAsync(values);
      toast.success('Cubicación certificada');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error creando cubicación');
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Cubicaciones / Certificaciones</h1>
          <p className="text-sm text-gray-500 mt-0.5">Certificación de avance facturable por período (no puede superar el avance físico aprobado)</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Nueva cubicación
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
      {error && <ErrorState message="Error cargando cubicaciones" onRetry={() => refetch()} />}
      {!isLoading && !error && (
        cubicaciones.length === 0
          ? <EmptyState title="Sin cubicaciones" description="Crea la primera certificación de avance para facturar al cliente." action={<Button size="sm" onClick={() => setShowForm(true)}>Nueva cubicación</Button>} />
          : <DataTable columns={columns} data={cubicaciones} onRowClick={setSelected} />
      )}

      {/* Detalle */}
      {selected && (
        <Modal open onClose={() => setSelected(null)} title={`Cubicación ${selected.fechaCorte}`} size="lg">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={ESTADO_BADGE[selected.estado] ?? 'default'}>{selected.estado}</Badge>
              <span className="text-sm text-gray-500">{selected.lineas.length} partidas</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2">Partida</th>
                  <th className="text-right px-4 py-2">Cant. período</th>
                  <th className="text-right px-4 py-2">P. unitario</th>
                  <th className="text-right px-4 py-2">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {selected.lineas.map((l) => (
                  <tr key={l.id} className="border-t border-gray-50">
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{l.partidaId.slice(0, 12)}…</td>
                    <td className="px-4 py-2 text-right tabular-nums">{new Decimal(l.cantidadPeriodo).toFixed(4)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{new Decimal(l.precioUnitario).toFixed(2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{new Decimal(l.subtotal).toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td colSpan={3} className="px-4 py-2 text-right">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums">{new Decimal(selected.subtotal).toFixed(2)} {selected.moneda}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cerrar</Button>
            <Button
              variant="outline"
              aria-label="Descargar PDF cubicación"
              onClick={() => void pdfMut.descargar(selected.id)}
              disabled={pdfMut.isPending}
            >
              <FileDown size={14} className="mr-1.5" />
              {pdfMut.isPending ? 'Generando…' : 'Descargar PDF'}
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Formulario */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nueva Cubicación" size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Proyecto" required error={errors.proyectoId?.message}>
              <select {...register('proyectoId')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">Seleccionar…</option>
                {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </FormField>
            <FormField label="Empresa" required error={errors.empresaId?.message}>
              <select {...register('empresaId')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">Seleccionar…</option>
                {proyectos.map((p) => <option key={p.empresaId} value={p.empresaId}>{p.empresaId.slice(0, 8)}…</option>)}
              </select>
            </FormField>
            <FormField label="Fecha de corte" required error={errors.fechaCorte?.message}>
              <Input type="date" {...register('fechaCorte')} />
            </FormField>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Partidas y cantidades</p>
            <div className="space-y-2">
              {fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[2fr_1fr_auto] gap-2 items-start p-3 bg-gray-50 rounded-lg">
                  <Input {...register(`lineas.${i}.partidaId`)} placeholder="Partida ID (UUID)" className="text-xs" />
                  <Input {...register(`lineas.${i}.cantidadPeriodo`)} placeholder="Cantidad período" className="text-xs" />
                  <button type="button" onClick={() => remove(i)} className="p-1.5 text-gray-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={() => append({ partidaId: '', cantidadPeriodo: '0.0000' })}>
                <Plus size={12} className="mr-1" />Agregar partida
              </Button>
            </div>
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            <FileCheck size={14} className="mr-1.5" />
            {crearMut.isPending ? 'Certificando…' : 'Certificar avance'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
