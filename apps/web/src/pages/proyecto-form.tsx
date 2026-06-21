import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  zProyectoCreate,
  TIPOS_OBRA,
  type ProyectoCreateInput,
} from '@tributia/proyectos';
import { useCreateProyecto, useUpdateProyecto, useProyecto, useTercerosClientes } from '@/hooks/use-proyectos';
import { MoneyInput } from '@/components/ui/money-input';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';

type Mode = 'create' | 'edit';

interface ProyectoFormPageProps {
  mode: Mode;
}

const TIPO_OBRA_LABELS: Record<string, string> = {
  RESIDENCIAL:   'Residencial',
  COMERCIAL:     'Comercial',
  INDUSTRIAL:    'Industrial',
  VIAL:          'Vial',
  HIDRAULICO:    'Hidráulico',
  INSTITUCIONAL: 'Institucional',
  MIXTO:         'Mixto',
  OTRO:          'Otro',
};

const nullIfEmpty = (v: unknown) => (v === '' ? undefined : v);

function FormField({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
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

export function ProyectoFormPage({ mode }: ProyectoFormPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // En modo edit cargamos el proyecto existente
  const { data: existing, isLoading: loadingExisting } = useProyecto(
    mode === 'edit' ? (id ?? '') : '',
  );
  const { data: terceros = [], isLoading: loadingTerceros } = useTercerosClientes();

  const createMutation = useCreateProyecto();
  const updateMutation = useUpdateProyecto(id ?? '');
  const isPending = createMutation.isPending || updateMutation.isPending;

  // zodResolver usa el mismo schema que valida el backend — sin duplicar reglas
  const form = useForm<ProyectoCreateInput>({
    resolver: zodResolver(zProyectoCreate),
    defaultValues: {
      codigo: '',
      nombre: '',
      descripcion: undefined,
      tipoObra: undefined as never,
      clienteId: '',
      numeroContrato: undefined,
      montoContrato: undefined,
      monedaContrato: 'DOP',
      fechaInicioPlanificada: undefined,
      fechaFinPlanificada: undefined,
      ubicacionDescripcion: undefined,
    },
  });

  // Pre-poblar en modo edición cuando carga el proyecto
  useEffect(() => {
    if (mode === 'edit' && existing) {
      form.reset({
        codigo:                  existing.codigo,
        nombre:                  existing.nombre,
        descripcion:             existing.descripcion ?? undefined,
        tipoObra:                existing.tipoObra,
        clienteId:               existing.clienteId,
        numeroContrato:          existing.numeroContrato ?? undefined,
        montoContrato:           existing.montoContrato ?? undefined,
        monedaContrato:          existing.monedaContrato ?? 'DOP',
        fechaInicioPlanificada:  existing.fechaInicioPlanificada ?? undefined,
        fechaFinPlanificada:     existing.fechaFinPlanificada ?? undefined,
        ubicacionDescripcion:    existing.ubicacionDescripcion ?? undefined,
      });
    }
  }, [existing, mode, form]);

  const { errors } = form.formState;

  async function onSubmit(values: ProyectoCreateInput) {
    try {
      if (mode === 'create') {
        const proyecto = await createMutation.mutateAsync(values);
        toast.success('Proyecto creado');
        navigate(`/proyectos/${proyecto.id}`);
      } else {
        await updateMutation.mutateAsync(values);
        toast.success('Proyecto actualizado');
        navigate(`/proyectos/${id}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error guardando proyecto';
      form.setError('root', { message: msg });
    }
  }

  if (mode === 'edit' && loadingExisting) return <LoadingScreen />;

  const moneda = form.watch('monedaContrato') as 'DOP' | 'USD';

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate(mode === 'edit' ? `/proyectos/${id}` : '/proyectos')}
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors mb-2 flex items-center gap-1"
        >
          ← Volver
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {mode === 'create' ? 'Nuevo proyecto' : 'Editar proyecto'}
        </h1>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Error global de API */}
        {errors.root && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {errors.root.message}
          </div>
        )}

        {/* Código y nombre */}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Código" required error={errors.codigo?.message}>
            <Input
              {...form.register('codigo')}
              placeholder="OBR-001"
              className={errors.codigo ? 'border-red-400' : ''}
            />
          </FormField>
          <FormField label="Nombre" required error={errors.nombre?.message}>
            <Input
              {...form.register('nombre')}
              placeholder="Ej: Edificio Central Norte"
              className={errors.nombre ? 'border-red-400' : ''}
            />
          </FormField>
        </div>

        {/* Cliente */}
        <FormField label="Cliente" required error={errors.clienteId?.message}>
          <select
            {...form.register('clienteId')}
            disabled={loadingTerceros}
            className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
          >
            <option value="">
              {loadingTerceros ? 'Cargando clientes…' : 'Seleccionar cliente…'}
            </option>
            {terceros.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}{t.rnc ? ` (${t.rnc})` : ''}
              </option>
            ))}
          </select>
        </FormField>

        {/* Tipo de obra */}
        <FormField label="Tipo de obra" required error={errors.tipoObra?.message}>
          <select
            {...form.register('tipoObra')}
            className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Seleccionar tipo…</option>
            {TIPOS_OBRA.map((t) => (
              <option key={t} value={t}>{TIPO_OBRA_LABELS[t] ?? t}</option>
            ))}
          </select>
        </FormField>

        {/* Monto de contrato */}
        <FormField label="Monto de contrato" error={errors.montoContrato?.message}>
          <Controller
            name="montoContrato"
            control={form.control}
            render={({ field }) => (
              <MoneyInput
                value={field.value ?? undefined}
                onChange={(v) => field.onChange(v === '0.0000' ? undefined : v)}
                currency={moneda === 'USD' ? 'USD' : 'DOP'}
                onCurrencyChange={(c) => form.setValue('monedaContrato', c)}
              />
            )}
          />
          <p className="mt-0.5 text-xs text-gray-400">Déjalo en 0 si aún no hay contrato.</p>
        </FormField>

        {/* Número de contrato */}
        <FormField label="Número de contrato" error={errors.numeroContrato?.message}>
          <Input
            {...form.register('numeroContrato', { setValueAs: nullIfEmpty })}
            placeholder="Ej: CONT-2025-001"
          />
        </FormField>

        {/* Fechas */}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Inicio planificado" error={errors.fechaInicioPlanificada?.message}>
            <Input
              type="date"
              {...form.register('fechaInicioPlanificada', { setValueAs: nullIfEmpty })}
            />
          </FormField>
          <FormField label="Fin planificado" error={errors.fechaFinPlanificada?.message}>
            <Input
              type="date"
              {...form.register('fechaFinPlanificada', { setValueAs: nullIfEmpty })}
            />
          </FormField>
        </div>

        {/* Ubicación */}
        <FormField label="Ubicación" error={errors.ubicacionDescripcion?.message}>
          <Input
            {...form.register('ubicacionDescripcion', { setValueAs: nullIfEmpty })}
            placeholder="Ej: Santo Domingo Norte, Sector Los Alcarrizos"
          />
        </FormField>

        {/* Descripción */}
        <FormField label="Descripción" error={errors.descripcion?.message}>
          <textarea
            {...form.register('descripcion', { setValueAs: nullIfEmpty })}
            rows={3}
            placeholder="Descripción opcional del proyecto…"
            className="flex w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
        </FormField>

        {/* Acciones */}
        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending
              ? mode === 'create' ? 'Creando…' : 'Guardando…'
              : mode === 'create' ? 'Crear proyecto' : 'Guardar cambios'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate(mode === 'edit' ? `/proyectos/${id}` : '/proyectos')}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
