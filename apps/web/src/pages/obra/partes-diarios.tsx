import { useState } from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, CloudSun, Users, Truck, TrendingUp, CheckCircle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  zParteDiarioCreate,
  CLIMAS, CLIMA_LABELS, TIPOS_PERSONAL,
  type ParteDiarioCreateInput,
} from '@tributia/obra';
import {
  usePartesDiarios,
  useCreateParteDiario,
  useConfirmarParte,
  type ParteDiario,
} from '@/hooks/use-obra';
import { useProyectos } from '@/hooks/use-proyectos';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';

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

function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-gray-100 mb-3">
      <Icon size={16} className="text-brand-500" />
      <h3 className="text-sm font-semibold text-gray-800">{label}</h3>
    </div>
  );
}

const columns: ColumnDef<ParteDiario>[] = [
  {
    accessorKey: 'fecha',
    header: 'Fecha',
    cell: ({ row }) => <span className="font-medium text-gray-900">{row.original.fecha}</span>,
  },
  {
    accessorKey: 'clima',
    header: 'Clima',
    cell: ({ row }) => row.original.clima
      ? CLIMA_LABELS[row.original.clima as keyof typeof CLIMA_LABELS] ?? row.original.clima
      : '—',
  },
  {
    id: 'personal',
    header: 'Personal',
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">{row.original.personal.length} personas</span>
    ),
  },
  {
    id: 'equipos',
    header: 'Equipos',
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">{row.original.equipos.length} equipos</span>
    ),
  },
  {
    id: 'avances',
    header: 'Avances',
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">{row.original.avances.length} partidas</span>
    ),
  },
  {
    accessorKey: 'confirmado',
    header: 'Estado',
    cell: ({ row }) => (
      <Badge variant={row.original.confirmado ? 'success' : 'warning'}>
        {row.original.confirmado ? 'Confirmado' : 'Borrador'}
      </Badge>
    ),
  },
];

export function ParteDiarioPage() {
  const [showForm, setShowForm] = useState(false);
  const [proyectoFiltro, setProyectoFiltro] = useState('');
  const [selected, setSelected] = useState<ParteDiario | null>(null);

  const { data: partes = [], isLoading, error, refetch } = usePartesDiarios(proyectoFiltro || undefined);
  const { data: proyectos = [] } = useProyectos();
  const crearMut = useCreateParteDiario();
  const confirmarMut = useConfirmarParte();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<ParteDiarioCreateInput>({
    resolver: zodResolver(zParteDiarioCreate),
    defaultValues: {
      idempotencyKey: uuidv4(),
      proyectoId: '',
      empresaId: '',
      fecha: new Date().toISOString().slice(0, 10),
      personal: [],
      equipos: [],
      avances: [],
    },
  });

  const personalFields = useFieldArray({ control, name: 'personal' });
  const equipoFields  = useFieldArray({ control, name: 'equipos' });
  const avanceFields  = useFieldArray({ control, name: 'avances' });

  async function onSubmit(values: ParteDiarioCreateInput) {
    try {
      await crearMut.mutateAsync({ ...values, idempotencyKey: uuidv4() });
      toast.success('Parte diario registrado');
      reset({ ...values, idempotencyKey: uuidv4(), personal: [], equipos: [], avances: [] });
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error guardando parte');
    }
  }

  async function handleConfirmar(id: string) {
    try {
      await confirmarMut.mutateAsync(id);
      toast.success('Parte diario confirmado');
      setSelected(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error confirmando parte');
    }
  }

  const proyectoActivo = proyectos[0];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Partes Diarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">Registro diario de personal, equipos y avance físico en obra</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Nuevo Parte
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
      {error && <ErrorState message="Error cargando partes diarios" onRetry={() => refetch()} />}

      {!isLoading && !error && (
        partes.length === 0
          ? <EmptyState title="Sin partes diarios" description="Registra el primer parte del día para este proyecto." action={<Button size="sm" onClick={() => setShowForm(true)}>Nuevo Parte</Button>} />
          : <DataTable columns={columns} data={partes} searchPlaceholder="Buscar parte…" onRowClick={setSelected} />
      )}

      {/* Detalle / Confirmar */}
      {selected && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={`Parte ${selected.fecha}`} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Clima:</span> <span className="font-medium">{selected.clima ? CLIMA_LABELS[selected.clima as keyof typeof CLIMA_LABELS] : '—'}</span></div>
              <div><span className="text-gray-500">Temperatura:</span> <span className="font-medium">{selected.temperaturaC ? `${selected.temperaturaC}°C` : '—'}</span></div>
            </div>
            {selected.notas && <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{selected.notas}</p>}

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Personal ({selected.personal.length})</p>
              {selected.personal.map((p) => (
                <div key={p.id} className="flex justify-between text-sm py-1 border-b border-gray-50">
                  <span>{p.nombre} <span className="text-xs text-gray-400">({p.tipo})</span></span>
                  <span className="tabular-nums">{p.horasTrabajadas}h</span>
                </div>
              ))}
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Avances ({selected.avances.length})</p>
              {selected.avances.map((a) => (
                <div key={a.id} className="flex justify-between text-sm py-1 border-b border-gray-50">
                  <span className="font-mono text-xs text-gray-500">{a.partidaId.slice(0, 8)}…</span>
                  {/* avance por CANTIDAD, nunca por porcentaje */}
                  <span className="tabular-nums font-semibold">{a.cantidadEjecutada} {a.unidad}</span>
                </div>
              ))}
            </div>

            {!selected.confirmado && (
              <div className="pt-2">
                <Button onClick={() => handleConfirmar(selected.id)} disabled={confirmarMut.isPending} className="w-full">
                  <CheckCircle size={14} className="mr-1.5" />
                  {confirmarMut.isPending ? 'Confirmando…' : 'Confirmar parte diario'}
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Modal: Nuevo Parte Diario */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nuevo Parte Diario" size="xl">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Datos generales */}
          <div>
            <SectionHeader icon={CloudSun} label="Datos generales" />
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Proyecto" required error={errors.proyectoId?.message}>
                <select
                  {...register('proyectoId')}
                  defaultValue={proyectoActivo?.id ?? ''}
                  className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Seleccionar…</option>
                  {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </FormField>
              <FormField label="Empresa" required error={errors.empresaId?.message}>
                <select
                  {...register('empresaId')}
                  className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Seleccionar…</option>
                  {proyectoActivo && <option value={proyectoActivo.empresaId}>{proyectoActivo.empresaId.slice(0, 8)}…</option>}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4">
              <FormField label="Fecha" required error={errors.fecha?.message}>
                <Input type="date" {...register('fecha')} />
              </FormField>
              <FormField label="Clima" error={errors.clima?.message}>
                <select
                  {...register('clima')}
                  className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Sin registrar</option>
                  {CLIMAS.map((c) => <option key={c} value={c}>{CLIMA_LABELS[c]}</option>)}
                </select>
              </FormField>
              <FormField label="Temperatura (°C)" error={errors.temperaturaC?.message}>
                <Input {...register('temperaturaC')} placeholder="28.5" />
              </FormField>
            </div>
            <div className="mt-4">
              <FormField label="Notas del día">
                <textarea
                  {...register('notas')}
                  rows={2}
                  placeholder="Novedades, incidentes, observaciones generales…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </FormField>
            </div>
          </div>

          {/* Personal */}
          <div>
            <SectionHeader icon={Users} label="Personal presente" />
            <div className="space-y-2">
              {personalFields.fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 items-start p-3 bg-gray-50 rounded-lg">
                  <Input {...register(`personal.${i}.nombre`)} placeholder="Nombre" className="text-xs" />
                  <select
                    {...register(`personal.${i}.tipo`)}
                    className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {TIPOS_PERSONAL.map((t) => <option key={t} value={t}>{t === 'PROPIO' ? 'Propio' : 'Subcontrat.'}</option>)}
                  </select>
                  <Input {...register(`personal.${i}.horasTrabajadas`)} placeholder="Horas" className="text-xs" />
                  <Input {...register(`personal.${i}.partidaId`)} placeholder="Partida ID" className="text-xs" />
                  <Input {...register(`personal.${i}.tarifaHoraria`)} placeholder="Tarifa/h" className="text-xs" />
                  <button type="button" onClick={() => personalFields.remove(i)} className="p-1.5 text-gray-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <Button
                type="button" size="sm" variant="outline"
                onClick={() => personalFields.append({ idempotencyKey: uuidv4(), nombre: '', tipo: 'PROPIO', horasTrabajadas: '8.0000', partidaId: '', tarifaHoraria: '0.0000', moneda: 'DOP' })}
              >
                <Plus size={12} className="mr-1" />Agregar trabajador
              </Button>
            </div>
          </div>

          {/* Equipos */}
          <div>
            <SectionHeader icon={Truck} label="Equipos" />
            <div className="space-y-2">
              {equipoFields.fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-start p-3 bg-gray-50 rounded-lg">
                  <Input {...register(`equipos.${i}.equipoId`)} placeholder="Equipo ID (UUID)" className="text-xs" />
                  <Input {...register(`equipos.${i}.horasOperadas`)} placeholder="Horas op." className="text-xs" />
                  <Input {...register(`equipos.${i}.partidaId`)} placeholder="Partida ID" className="text-xs" />
                  <button type="button" onClick={() => equipoFields.remove(i)} className="p-1.5 text-gray-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <Button
                type="button" size="sm" variant="outline"
                onClick={() => equipoFields.append({ idempotencyKey: uuidv4(), equipoId: '', horasOperadas: '8.0000', partidaId: '', moneda: 'DOP' })}
              >
                <Plus size={12} className="mr-1" />Agregar equipo
              </Button>
            </div>
          </div>

          {/* Avances — por CANTIDAD ejecutada, nunca porcentaje */}
          <div>
            <SectionHeader icon={TrendingUp} label="Avance físico por partida" />
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              Ingresa la <strong>cantidad ejecutada</strong> en las unidades de la partida (m³, m², UND, etc.). El sistema calcula el avance acumulado — no hay campo de porcentaje.
            </p>
            <div className="space-y-2">
              {avanceFields.fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-start p-3 bg-gray-50 rounded-lg">
                  <Input {...register(`avances.${i}.partidaId`)} placeholder="Partida ID (UUID)" className="text-xs" />
                  {/* CANTIDAD ejecutada — no porcentaje */}
                  <div>
                    <Input {...register(`avances.${i}.cantidadEjecutada`)} placeholder="Cant. ejecutada" className="text-xs" />
                    {errors.avances?.[i]?.cantidadEjecutada && (
                      <p className="text-xs text-red-500 mt-0.5">{errors.avances[i]?.cantidadEjecutada?.message}</p>
                    )}
                  </div>
                  <Input {...register(`avances.${i}.unidad`)} placeholder="Unidad (m³, UND…)" className="text-xs" />
                  <button type="button" onClick={() => avanceFields.remove(i)} className="p-1.5 text-gray-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <Button
                type="button" size="sm" variant="outline"
                onClick={() => avanceFields.append({ idempotencyKey: uuidv4(), partidaId: '', cantidadEjecutada: '0.0000', unidad: 'm³' })}
              >
                <Plus size={12} className="mr-1" />Agregar avance
              </Button>
            </div>
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            {crearMut.isPending ? 'Guardando…' : 'Guardar Parte Diario'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
