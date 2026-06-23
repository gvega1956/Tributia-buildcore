import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Play } from 'lucide-react';
import { zProgramarPago, type ProgramarPagoInput } from '@tributia/tesoreria';
import {
  useProgramarPago,
  useEjecutarLotePagos,
  type ProgramacionPago,
} from '@/hooks/use-tesoreria';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import Decimal from 'decimal.js';

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

export function PagosPage() {
  const [showForm, setShowForm] = useState(false);
  const [cuentaLote, setCuentaLote] = useState('');
  const [pagosLocales, setPagosLocales] = useState<ProgramacionPago[]>([]);

  const programarMut = useProgramarPago();
  const lotesMut = useEjecutarLotePagos();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProgramarPagoInput>({
    resolver: zodResolver(zProgramarPago),
    defaultValues: {
      empresaId: '',
      cuentaPorPagarId: '',
      cuentaBancariaId: '',
      monto: '0.0000',
      moneda: 'DOP',
      fechaProgramada: new Date().toISOString().slice(0, 10),
      prioridad: 1,
    },
  });

  async function onProgramar(values: ProgramarPagoInput) {
    try {
      // Acción financiera — espera confirmación del servidor
      const pago = await programarMut.mutateAsync(values);
      toast.success('Pago programado');
      setPagosLocales((prev) => [...prev, pago]);
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error programando pago');
    }
  }

  async function handleEjecutarLote() {
    if (!cuentaLote.trim()) { toast.error('Ingresa el UUID de la cuenta bancaria'); return; }
    try {
      await lotesMut.mutateAsync(cuentaLote);
      toast.success('Lote de pagos ejecutado');
      setPagosLocales((prev) => prev.map((p) => p.cuentaBancariaId === cuentaLote ? { ...p, ejecutado: true } : p));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error ejecutando lote');
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Programación de Pagos</h1>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />Programar pago
        </Button>
      </div>

      {/* Gap: no existe GET /api/v1/tesoreria/programacion-pagos */}
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
        <span className="font-semibold">Gap #3:</span> No existe <span className="font-mono">GET /api/v1/tesoreria/programacion-pagos</span> — no se pueden listar pagos programados previos. Solo se muestran los registrados en esta sesión.
      </div>

      {/* Ejecutar lote */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Ejecutar lote</p>
        <p className="text-xs text-gray-500">Ejecuta todos los pagos programados pendientes para una cuenta bancaria.</p>
        <div className="flex items-center gap-2">
          <Input value={cuentaLote} onChange={(e) => setCuentaLote(e.target.value)} placeholder="UUID cuenta bancaria" className="flex-1" />
          <Button size="sm" onClick={handleEjecutarLote} disabled={lotesMut.isPending || !cuentaLote}>
            <Play size={13} className="mr-1.5" />
            {lotesMut.isPending ? 'Ejecutando…' : 'Ejecutar lote'}
          </Button>
        </div>
      </div>

      {/* Pagos de esta sesión */}
      {pagosLocales.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">Pagos programados esta sesión</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2">CxP</th>
                <th className="text-right px-4 py-2">Monto</th>
                <th className="text-center px-4 py-2">Fecha</th>
                <th className="text-center px-4 py-2">Prioridad</th>
                <th className="text-center px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {pagosLocales.map((p) => (
                <tr key={p.id} className="border-t border-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">{p.cuentaPorPagarId.slice(0, 8)}…</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{new Decimal(p.monto).toFixed(2)} {p.moneda}</td>
                  <td className="px-4 py-2 text-center">{p.fechaProgramada}</td>
                  <td className="px-4 py-2 text-center">{p.prioridad}</td>
                  <td className="px-4 py-2 text-center">
                    <Badge variant={p.ejecutado ? 'success' : 'warning'}>{p.ejecutado ? 'Ejecutado' : 'Pendiente'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagosLocales.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          No hay pagos programados en esta sesión. Usa "Programar pago" para agregar uno.
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Programar Pago" size="md">
        <form onSubmit={handleSubmit(onProgramar)} className="space-y-4">
          <FormField label="Empresa" required error={errors.empresaId?.message}>
            <Input {...register('empresaId')} placeholder="UUID empresa" />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="CxP (cuenta por pagar)" required error={errors.cuentaPorPagarId?.message}>
              <Input {...register('cuentaPorPagarId')} placeholder="UUID cuenta por pagar" />
            </FormField>
            <FormField label="Cuenta bancaria" required error={errors.cuentaBancariaId?.message}>
              <Input {...register('cuentaBancariaId')} placeholder="UUID cuenta bancaria" />
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Monto" required error={errors.monto?.message}>
              <Input {...register('monto')} placeholder="0.0000" />
            </FormField>
            <FormField label="Moneda">
              <select {...register('moneda')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="DOP">DOP</option>
                <option value="USD">USD</option>
              </select>
            </FormField>
            <FormField label="Prioridad">
              <Input type="number" {...register('prioridad', { valueAsNumber: true })} min={1} max={10} />
            </FormField>
          </div>
          <FormField label="Fecha programada" required error={errors.fechaProgramada?.message}>
            <Input type="date" {...register('fechaProgramada')} />
          </FormField>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onProgramar)} disabled={programarMut.isPending}>
            {programarMut.isPending ? 'Programando…' : 'Programar pago'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
