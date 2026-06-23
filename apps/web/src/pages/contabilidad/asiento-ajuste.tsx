import { useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { zAsientoAjusteCreate, validarBalance } from '@tributia/contabilidad';
import type { AsientoAjusteCreateInput } from '@tributia/contabilidad';
import { useRegistrarAjuste, type AsientoContable } from '@/hooks/use-contabilidad';
import { MoneyInput } from '@/components/ui/money-input';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import Decimal from 'decimal.js';

const MONEDAS = ['DOP', 'USD', 'EUR'] as const;

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

export function AsientoAjustePage() {
  const [asientoCreado, setAsientoCreado] = useState<AsientoContable | null>(null);
  const registrarMut = useRegistrarAjuste();

  const { register, handleSubmit, control, watch, reset, formState: { errors } } = useForm<AsientoAjusteCreateInput>({
    resolver: zodResolver(zAsientoAjusteCreate),
    defaultValues: {
      empresaId: '',
      fecha: new Date().toISOString().slice(0, 10),
      descripcion: '',
      lineas: [
        { cuentaCodigo: '', tipo: 'debe', importe: '0.0000', moneda: 'DOP' },
        { cuentaCodigo: '', tipo: 'haber', importe: '0.0000', moneda: 'DOP' },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });
  const lineas = watch('lineas');

  // Verificación en tiempo real — Σdebe = Σhaber
  const totalDebe = lineas
    .filter((l) => l.tipo === 'debe')
    .reduce((s, l) => {
      try { return s.plus(l.importe || '0'); } catch { return s; }
    }, new Decimal(0));
  const totalHaber = lineas
    .filter((l) => l.tipo === 'haber')
    .reduce((s, l) => {
      try { return s.plus(l.importe || '0'); } catch { return s; }
    }, new Decimal(0));
  const cuadra = totalDebe.equals(totalHaber);

  async function onSubmit(values: AsientoAjusteCreateInput) {
    // Doble validación: el hook también valida con validarBalance
    if (!validarBalance(values.lineas.map((l) => ({ ...l, moneda: l.moneda ?? 'DOP' })))) {
      toast.error('El asiento no cuadra: Σdebe ≠ Σhaber');
      return;
    }
    try {
      // Acción financiera — éxito solo tras confirmación del servidor
      const asiento = await registrarMut.mutateAsync(values);
      toast.success('Asiento de ajuste registrado');
      setAsientoCreado(asiento);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error registrando asiento');
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Asiento Manual de Ajuste</h1>
        <p className="text-sm text-gray-500 mt-0.5">Solo para ajustes contables — el tipo 'automático' lo genera el sistema desde los eventos del ledger</p>
      </div>

      {asientoCreado && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
          ✓ Asiento registrado: <span className="font-mono font-semibold">{asientoCreado.id}</span> — {asientoCreado.fecha}
          <button onClick={() => setAsientoCreado(null)} className="ml-3 text-green-600 underline text-xs">Nuevo asiento</button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Empresa ID" required error={errors.empresaId?.message}>
            <Input {...register('empresaId')} placeholder="UUID de la empresa" />
          </FormField>
          <FormField label="Fecha" required error={errors.fecha?.message}>
            <Input type="date" {...register('fecha')} />
          </FormField>
          <div />
        </div>
        <FormField label="Descripción del ajuste" required error={errors.descripcion?.message}>
          <textarea
            {...register('descripcion')}
            rows={2}
            placeholder="Motivo del ajuste contable…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </FormField>

        {/* Líneas */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-700">Líneas del asiento</p>
            {/* Verificación cuadre en tiempo real */}
            {!cuadra && lineas.length >= 2 && (
              <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                <AlertTriangle size={12} />
                No cuadra: Debe {totalDebe.toFixed(2)} / Haber {totalHaber.toFixed(2)}
              </span>
            )}
            {cuadra && lineas.length >= 2 && (
              <span className="text-xs text-green-600 font-medium">✓ Cuadra ({totalDebe.toFixed(2)})</span>
            )}
          </div>

          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-start p-3 bg-gray-50 rounded-lg">
                <div>
                  <Input {...register(`lineas.${i}.cuentaCodigo`)} placeholder="Código cuenta (ej. 1100)" className="text-xs" />
                  {errors.lineas?.[i]?.cuentaCodigo && (
                    <p className="text-xs text-red-500 mt-0.5">{errors.lineas[i]?.cuentaCodigo?.message}</p>
                  )}
                </div>
                <select
                  {...register(`lineas.${i}.tipo`)}
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="debe">Debe</option>
                  <option value="haber">Haber</option>
                </select>
                <Controller
                  control={control}
                  name={`lineas.${i}.importe`}
                  render={({ field }) => (
                    <MoneyInput value={field.value} onChange={field.onChange} placeholder="0.00" />
                  )}
                />
                <select
                  {...register(`lineas.${i}.moneda`)}
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <button type="button" onClick={() => remove(i)} className="p-1.5 text-gray-400 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <Button
            type="button" size="sm" variant="outline" className="mt-2"
            onClick={() => append({ cuentaCodigo: '', tipo: 'debe', importe: '0.0000', moneda: 'DOP' })}
          >
            <Plus size={12} className="mr-1" />Agregar línea
          </Button>
        </div>

        <div className="pt-4 flex justify-end">
          <Button
            onClick={handleSubmit(onSubmit)}
            disabled={registrarMut.isPending || !cuadra}
            className="min-w-36"
          >
            {registrarMut.isPending ? 'Registrando…' : 'Registrar asiento'}
          </Button>
        </div>
        {/* Éxito solo tras confirmación del servidor — disabled hasta que cuadre */}
        {!cuadra && (
          <p className="text-xs text-gray-400 text-right">El botón se habilita cuando Σdebe = Σhaber</p>
        )}
      </div>
    </div>
  );
}
