import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { zCubicacionProyectada, type CubicacionProyectadaInput } from '@tributia/tesoreria';
import {
  useFlujoCajaPorProyecto,
  useFlujoCajaConsolidado,
  useCubicacionesProyectadas,
  useRegistrarCubicacionProyectada,
  useEliminarCubicacionProyectada,
  type SemanaFlujo,
} from '@/hooks/use-tesoreria';
import { useProyectos } from '@/hooks/use-proyectos';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
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

function BarChart({ semanas }: { semanas: SemanaFlujo[] }) {
  if (!semanas.length) return null;

  const maxAbs = semanas.reduce((m, s) => {
    const abs = Math.max(
      Math.abs(parseFloat(s.ingresos)),
      Math.abs(parseFloat(s.egresos)),
      Math.abs(parseFloat(s.saldoAcumulado)),
    );
    return Math.max(m, abs);
  }, 1);

  const pct = (v: string) => Math.min(100, (Math.abs(parseFloat(v)) / maxAbs) * 100);

  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-2 min-w-max px-1 pb-2" style={{ minHeight: 160 }}>
        {semanas.map((s) => {
          const neto = new Decimal(s.neto);
          const isDeficit = s.alertaDeficit;
          return (
            <div key={s.semana} className="flex flex-col items-center gap-1 w-16">
              <div className="flex flex-col items-center w-full gap-0.5" style={{ height: 120 }}>
                {/* Ingresos bar */}
                <div className="w-4 bg-green-400 rounded-sm self-end" style={{ height: `${pct(s.ingresos)}%`, minHeight: 2 }} title={`Ingresos: ${s.ingresos}`} />
                {/* Egresos bar */}
                <div className="w-4 bg-red-400 rounded-sm self-end" style={{ height: `${pct(s.egresos)}%`, minHeight: 2 }} title={`Egresos: ${s.egresos}`} />
              </div>
              {isDeficit && <AlertTriangle size={10} className="text-red-600 shrink-0" />}
              <span className={`text-[10px] font-medium ${isDeficit ? 'text-red-600' : neto.gte(0) ? 'text-green-700' : 'text-gray-500'}`}>
                {neto.gte(0) ? '+' : ''}{neto.toFixed(0)}
              </span>
              <span className="text-[9px] text-gray-400">{s.semana}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 px-1 pt-1 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-green-400 rounded-sm inline-block" />Ingresos</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-red-400 rounded-sm inline-block" />Egresos</span>
        <span className="flex items-center gap-1"><AlertTriangle size={10} className="text-red-600" />Déficit</span>
      </div>
    </div>
  );
}

export function FlujoCajaPage() {
  const [mode, setMode] = useState<'proyecto' | 'consolidado'>('proyecto');
  const [proyectoId, setProyectoId] = useState('');
  const [empresaId, setEmpresaId] = useState('');
  const [showCubForm, setShowCubForm] = useState(false);

  const { data: proyectos = [] } = useProyectos();

  const flujoPQ = useFlujoCajaPorProyecto(proyectoId);
  const flujoCQ = useFlujoCajaConsolidado(empresaId);
  const cubicacionesQ = useCubicacionesProyectadas(proyectoId);
  const registrarCubMut = useRegistrarCubicacionProyectada();
  const eliminarCubMut = useEliminarCubicacionProyectada();

  const flujo = mode === 'proyecto' ? flujoPQ.data : flujoCQ.data;
  const isLoading = mode === 'proyecto' ? flujoPQ.isLoading : flujoCQ.isLoading;
  const flujoError = mode === 'proyecto' ? flujoPQ.error : flujoCQ.error;

  const { register: regCub, handleSubmit: submitCub, reset: resetCub, formState: { errors: errCub } } = useForm<CubicacionProyectadaInput>({
    resolver: zodResolver(zCubicacionProyectada),
    defaultValues: { empresaId: '', proyectoId: '', fechaProyectada: '', montoProyectado: '0.0000', moneda: 'DOP', descripcion: '' },
  });

  async function onCrearCubicacion(values: CubicacionProyectadaInput) {
    if (!proyectoId) { toast.error('Selecciona un proyecto primero'); return; }
    try {
      const input = { ...values, proyectoId };
      await registrarCubMut.mutateAsync({ proyectoId, input });
      toast.success('Cubicación proyectada registrada');
      resetCub();
      setShowCubForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error registrando cubicación');
    }
  }

  async function handleEliminar(id: string) {
    if (!proyectoId) return;
    try {
      await eliminarCubMut.mutateAsync({ proyectoId, id });
      toast.success('Cubicación proyectada eliminada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error eliminando');
    }
  }

  const deficits = flujo?.semanas.filter((s) => s.alertaDeficit) ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Flujo de Caja Proyectado</h1>

      {/* Modo */}
      <div className="flex gap-2">
        {(['proyecto', 'consolidado'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:text-gray-900'}`}
          >
            {m === 'proyecto' ? 'Por proyecto' : 'Consolidado empresa'}
          </button>
        ))}
      </div>

      {/* Selector */}
      {mode === 'proyecto' ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Proyecto</label>
          <select value={proyectoId} onChange={(e) => setProyectoId(e.target.value)} className="w-full max-w-sm h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">Seleccionar proyecto…</option>
            {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
          <Input value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} placeholder="UUID empresa" className="max-w-sm" />
        </div>
      )}

      {/* Alertas déficit */}
      {deficits.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">{deficits.length} semana{deficits.length > 1 ? 's' : ''} con déficit proyectado:</span>{' '}
            {deficits.map((d) => d.semana).join(', ')}
          </div>
        </div>
      )}

      {/* KPIs */}
      {flujo && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Saldo inicial</p>
            <p className="text-xl font-bold tabular-nums">{new Decimal(flujo.saldoInicial).toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Saldo final (13 sem)</p>
            <p className={`text-xl font-bold tabular-nums ${new Decimal(flujo.saldoFinal).lt(0) ? 'text-red-600' : 'text-green-700'}`}>
              {new Decimal(flujo.saldoFinal).toFixed(2)}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-1">
              {new Decimal(flujo.saldoFinal).gte(new Decimal(flujo.saldoInicial))
                ? <TrendingUp size={14} className="text-green-500" />
                : <TrendingDown size={14} className="text-red-500" />}
              <p className="text-xs text-gray-500 uppercase tracking-wide">Variación</p>
            </div>
            <p className={`text-xl font-bold tabular-nums ${new Decimal(flujo.saldoFinal).minus(flujo.saldoInicial).lt(0) ? 'text-red-600' : 'text-green-700'}`}>
              {new Decimal(flujo.saldoFinal).minus(flujo.saldoInicial).toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {/* Gráfico */}
      {isLoading && <LoadingSpinner />}
      {flujoError && <ErrorState message="Error cargando flujo de caja" onRetry={() => mode === 'proyecto' ? flujoPQ.refetch() : flujoCQ.refetch()} />}
      {flujo && flujo.semanas.length === 0 && <EmptyState title="Sin datos de flujo" description="No hay proyecciones para el período." />}
      {flujo && flujo.semanas.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
          <p className="text-sm font-semibold text-gray-700">Próximas 13 semanas</p>
          <BarChart semanas={flujo.semanas} />

          {/* Tabla detalle */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-max">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Semana</th>
                  <th className="text-left px-3 py-2">Desde</th>
                  <th className="text-right px-3 py-2">Ingresos</th>
                  <th className="text-right px-3 py-2">Egresos</th>
                  <th className="text-right px-3 py-2">Neto</th>
                  <th className="text-right px-3 py-2">Saldo acum.</th>
                  <th className="text-center px-3 py-2">Alerta</th>
                </tr>
              </thead>
              <tbody>
                {flujo.semanas.map((s) => (
                  <tr key={s.semana} className={`border-t border-gray-50 ${s.alertaDeficit ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                    <td className="px-3 py-2 font-medium">{s.semana}</td>
                    <td className="px-3 py-2 text-gray-500">{s.fechaInicio}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700">+{new Decimal(s.ingresos).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">-{new Decimal(s.egresos).toFixed(2)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${new Decimal(s.neto).lt(0) ? 'text-red-600' : 'text-green-700'}`}>
                      {new Decimal(s.neto).toFixed(2)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${new Decimal(s.saldoAcumulado).lt(0) ? 'text-red-700' : ''}`}>
                      {new Decimal(s.saldoAcumulado).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {s.alertaDeficit && <AlertTriangle size={13} className="text-red-600 mx-auto" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cubicaciones proyectadas (solo modo proyecto) */}
      {mode === 'proyecto' && proyectoId && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Cubicaciones proyectadas</p>
            <Button size="sm" variant="outline" onClick={() => setShowCubForm(true)}>
              <Plus size={13} className="mr-1" />Agregar
            </Button>
          </div>

          {cubicacionesQ.isLoading && <LoadingSpinner />}
          {!cubicacionesQ.isLoading && (cubicacionesQ.data ?? []).length === 0 && (
            <p className="text-xs text-gray-400">Sin cubicaciones proyectadas. Agrega una para mejorar la proyección de ingresos.</p>
          )}
          {(cubicacionesQ.data ?? []).length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Fecha</th>
                  <th className="text-right px-3 py-2">Monto</th>
                  <th className="text-left px-3 py-2">Descripción</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(cubicacionesQ.data ?? []).map((c) => (
                  <tr key={c.id} className="border-t border-gray-50">
                    <td className="px-3 py-2">{c.fechaProyectada}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{new Decimal(c.montoProyectado).toFixed(2)} {c.moneda}</td>
                    <td className="px-3 py-2 text-gray-600">{c.descripcion ?? '—'}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleEliminar(c.id)}
                        disabled={eliminarCubMut.isPending}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal cubicación proyectada */}
      <Modal open={showCubForm} onClose={() => setShowCubForm(false)} title="Agregar Cubicación Proyectada" size="sm">
        <form onSubmit={submitCub(onCrearCubicacion)} className="space-y-4">
          <FormField label="Empresa" required error={errCub.empresaId?.message}>
            <Input {...regCub('empresaId')} placeholder="UUID empresa" autoFocus />
          </FormField>
          <FormField label="Fecha proyectada" required error={errCub.fechaProyectada?.message}>
            <Input type="date" {...regCub('fechaProyectada')} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Monto" required error={errCub.montoProyectado?.message}>
              <Input {...regCub('montoProyectado')} placeholder="0.0000" />
            </FormField>
            <FormField label="Moneda">
              <select {...regCub('moneda')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="DOP">DOP</option>
                <option value="USD">USD</option>
              </select>
            </FormField>
          </div>
          <FormField label="Descripción">
            <Input {...regCub('descripcion')} placeholder="Cubicación parcial bloque A" />
          </FormField>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowCubForm(false)}>Cancelar</Button>
          <Button onClick={submitCub(onCrearCubicacion)} disabled={registrarCubMut.isPending}>
            {registrarCubMut.isPending ? 'Registrando…' : 'Registrar'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
