import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, RefreshCw, Check, EyeOff } from 'lucide-react';
import { zImportarExtracto, type ImportarExtractoInput } from '@tributia/tesoreria';
import {
  useImportarExtracto,
  useConciliarAutomatico,
  useConciliarManual,
  useIgnorarLinea,
  type ExtractoBancario,
  type LineaExtracto,
} from '@/hooks/use-tesoreria';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import Decimal from 'decimal.js';

const ESTADO_LINEA_BADGE: Record<string, 'default' | 'success' | 'warning'> = {
  PENDIENTE: 'default',
  CONCILIADA: 'success',
  IGNORADA: 'warning',
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

function ExtractoPanel({ extracto, onClose }: { extracto: ExtractoBancario; onClose: () => void }) {
  const [movimientoId, setMovimientoId] = useState('');
  const [lineaSeleccionada, setLineaSeleccionada] = useState<LineaExtracto | null>(null);
  const conciliarAutoMut = useConciliarAutomatico();
  const conciliarManualMut = useConciliarManual();
  const ignorarMut = useIgnorarLinea();

  const pendientes = extracto.lineas.filter((l) => l.estado === 'PENDIENTE').length;
  const conciliadas = extracto.lineas.filter((l) => l.estado === 'CONCILIADA').length;

  async function handleConciliarAuto() {
    try {
      await conciliarAutoMut.mutateAsync(extracto.id);
      toast.success('Conciliación automática ejecutada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error en conciliación automática');
    }
  }

  async function handleConciliarManual(lineaId: string) {
    if (!movimientoId.trim()) return;
    try {
      await conciliarManualMut.mutateAsync({ lineaId, movimientoBancarioId: movimientoId });
      toast.success('Línea conciliada');
      setLineaSeleccionada(null);
      setMovimientoId('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error en conciliación manual');
    }
  }

  async function handleIgnorar(lineaId: string) {
    try {
      await ignorarMut.mutateAsync(lineaId);
      toast.success('Línea ignorada');
      setLineaSeleccionada(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error ignorando línea');
    }
  }

  return (
    <Modal open onClose={onClose} title={`Extracto ${extracto.archivoNombre}`} size="xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <span>{extracto.periodoDesde} → {extracto.periodoHasta}</span>
            <Badge variant="default">{pendientes} pendientes</Badge>
            <Badge variant="success">{conciliadas} conciliadas</Badge>
          </div>
          <Button size="sm" onClick={handleConciliarAuto} disabled={conciliarAutoMut.isPending || pendientes === 0}>
            <RefreshCw size={13} className={`mr-1.5 ${conciliarAutoMut.isPending ? 'animate-spin' : ''}`} />
            Conciliar automático
          </Button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <th className="text-left px-4 py-2">Fecha</th>
              <th className="text-left px-4 py-2">Descripción</th>
              <th className="text-right px-4 py-2">Monto</th>
              <th className="text-center px-4 py-2">Estado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {extracto.lineas.map((linea) => (
              <tr key={linea.id} className={`border-t border-gray-50 ${linea.estado === 'PENDIENTE' ? 'hover:bg-gray-50 cursor-pointer' : ''}`}>
                <td className="px-4 py-2">{linea.fecha}</td>
                <td className="px-4 py-2 text-gray-700">{linea.descripcion}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">
                  {new Decimal(linea.monto).gte(0)
                    ? <span className="text-green-700">+{new Decimal(linea.monto).abs().toFixed(2)}</span>
                    : <span className="text-red-700">{new Decimal(linea.monto).toFixed(2)}</span>
                  }
                </td>
                <td className="px-4 py-2 text-center">
                  <Badge variant={ESTADO_LINEA_BADGE[linea.estado] ?? 'default'}>{linea.estado}</Badge>
                </td>
                <td className="px-4 py-2">
                  {linea.estado === 'PENDIENTE' && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => setLineaSeleccionada(linea)}
                        className="p-1 text-brand-500 hover:bg-brand-50 rounded"
                        title="Conciliar manual"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        onClick={() => handleIgnorar(linea.id)}
                        className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                        title="Ignorar"
                      >
                        <EyeOff size={13} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Modal conciliar manual */}
        {lineaSeleccionada && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl space-y-4">
              <h3 className="font-semibold text-gray-900">Conciliar manualmente</h3>
              <p className="text-sm text-gray-600">{lineaSeleccionada.descripcion} — {new Decimal(lineaSeleccionada.monto).toFixed(2)}</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ID del movimiento bancario</label>
                <Input
                  value={movimientoId}
                  onChange={(e) => setMovimientoId(e.target.value)}
                  placeholder="UUID del movimiento"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => { setLineaSeleccionada(null); setMovimientoId(''); }}>Cancelar</Button>
                <Button size="sm" onClick={() => handleConciliarManual(lineaSeleccionada.id)} disabled={!movimientoId || conciliarManualMut.isPending}>
                  {conciliarManualMut.isPending ? 'Conciliando…' : 'Conciliar'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ConciliacionPage() {
  const [showForm, setShowForm] = useState(false);
  const [extracto, setExtracto] = useState<ExtractoBancario | null>(null);
  const importarMut = useImportarExtracto();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<ImportarExtractoInput>({
    resolver: zodResolver(zImportarExtracto),
    defaultValues: {
      cuentaBancariaId: '',
      empresaId: '',
      periodoDesde: '',
      periodoHasta: '',
      archivoNombre: 'extracto.csv',
      lineas: [{ fecha: '', descripcion: '', monto: '0.0000' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });

  async function onSubmit(values: ImportarExtractoInput) {
    try {
      const result = await importarMut.mutateAsync(values);
      toast.success(`Extracto importado: ${result.lineas.length} líneas`);
      reset();
      setShowForm(false);
      setExtracto(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error importando extracto');
    }
  }

  // Gap: no hay GET /api/v1/tesoreria/conciliacion/extractos — no se pueden listar extractos previos
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Conciliación Bancaria</h1>
          <p className="text-sm text-gray-500 mt-0.5">Importa el estado de cuenta y empareja contra movimientos del sistema</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Importar extracto
        </Button>
      </div>

      {/* Gap pendiente */}
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
        <span className="font-semibold">Gap #1:</span> No existe <span className="font-mono">GET /api/v1/tesoreria/conciliacion/extractos</span> — no se pueden listar extractos importados. Solo se puede importar y trabajar con el resultado inmediato.
      </div>

      {extracto && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">{extracto.archivoNombre}</p>
              <p className="text-sm text-gray-500">{extracto.periodoDesde} → {extracto.periodoHasta} · {extracto.lineas.length} líneas</p>
            </div>
            <Button size="sm" onClick={() => setExtracto(null)} variant="outline">
              Ver conciliación
            </Button>
          </div>
        </div>
      )}

      {extracto && <ExtractoPanel extracto={extracto} onClose={() => setExtracto(null)} />}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Importar Extracto Bancario" size="lg">
        {importarMut.isPending && <LoadingSpinner />}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Cuenta bancaria" required error={errors.cuentaBancariaId?.message}>
              <Input {...register('cuentaBancariaId')} placeholder="UUID cuenta bancaria" />
            </FormField>
            <FormField label="Empresa" required error={errors.empresaId?.message}>
              <Input {...register('empresaId')} placeholder="UUID empresa" />
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Desde" required><Input type="date" {...register('periodoDesde')} /></FormField>
            <FormField label="Hasta" required><Input type="date" {...register('periodoHasta')} /></FormField>
            <FormField label="Nombre archivo"><Input {...register('archivoNombre')} placeholder="extracto.csv" /></FormField>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Líneas del extracto</p>
            <div className="space-y-2">
              {fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[1fr_2fr_1fr_auto] gap-2 items-start p-3 bg-gray-50 rounded-lg">
                  <Input type="date" {...register(`lineas.${i}.fecha`)} className="text-xs" />
                  <Input {...register(`lineas.${i}.descripcion`)} placeholder="Descripción" className="text-xs" />
                  <Input {...register(`lineas.${i}.monto`)} placeholder="Monto (+ crédito / - débito)" className="text-xs" />
                  <button type="button" onClick={() => remove(i)} className="p-1.5 text-gray-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={() => append({ fecha: '', descripcion: '', monto: '0.0000' })}>
                <Plus size={12} className="mr-1" />Agregar línea
              </Button>
            </div>
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={importarMut.isPending}>
            {importarMut.isPending ? 'Importando…' : 'Importar extracto'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
