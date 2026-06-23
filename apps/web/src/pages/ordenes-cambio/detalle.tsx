import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Plus, DollarSign, Clock, FileText } from 'lucide-react';
import {
  zLineaOrdenCambioAdd,
  zOrdenCambioAprobar,
  zOrdenCambioRechazar,
  TIPOS_IMPACTO,
  type LineaOrdenCambioAddInput,
  type OrdenCambioAprobarInput,
  type OrdenCambioRechazarInput,
} from '@tributia/ordenes-cambio';
import {
  useAddLineaOC,
  useEnviarOCAlCliente,
  useAprobarOC,
  useRechazarOC,
  useAnularOC,
  type OrdenCambio,
} from '@/hooks/use-ordenes-cambio';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ApprovalActions } from '@/components/ui/approval-actions';
import { toast } from '@/components/ui/toast';
import { Controller, useController } from 'react-hook-form';
import Decimal from 'decimal.js';

const ESTADO_BADGE: Record<string, 'default' | 'info' | 'success' | 'danger' | 'warning'> = {
  BORRADOR: 'default',
  ENVIADA_CLIENTE: 'info',
  APROBADA: 'success',
  RECHAZADA: 'danger',
  ANULADA: 'warning',
};

const ESTADO_LABEL: Record<string, string> = {
  BORRADOR: 'Borrador',
  ENVIADA_CLIENTE: 'Enviada al cliente',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  ANULADA: 'Anulada',
};

const CAUSA_LABEL: Record<string, string> = {
  CLIENTE: 'Cambio del cliente',
  DISENO: 'Error de diseño',
  CAMPO: 'Condición de campo',
  IMPREVISTO: 'Imprevisto',
};

const TIPO_IMPACTO_LABEL: Record<string, string> = {
  COSTO: 'Solo costo',
  PLAZO: 'Solo plazo',
  COSTO_Y_PLAZO: 'Costo y plazo',
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

interface DetalleOrdenCambioProps {
  oc: OrdenCambio;
  onBack: () => void;
}

export function DetalleOrdenCambio({ oc, onBack }: DetalleOrdenCambioProps) {
  const [showLineaForm, setShowLineaForm] = useState(false);
  const [showAprobarForm, setShowAprobarForm] = useState(false);
  const [showRechazarForm, setShowRechazarForm] = useState(false);

  const addLineaMut = useAddLineaOC(oc.id);
  const enviarMut = useEnviarOCAlCliente();
  const aprobarMut = useAprobarOC();
  const rechazarMut = useRechazarOC();
  const anularMut = useAnularOC();

  // Línea form
  const lineaForm = useForm<LineaOrdenCambioAddInput>({
    resolver: zodResolver(zLineaOrdenCambioAdd),
    defaultValues: { descripcion: '', esPartidaNueva: false, montoAdicional: '0.0000', tipoImpacto: 'COSTO' },
  });

  // Aprobar form
  const aprobarForm = useForm<OrdenCambioAprobarInput>({
    resolver: zodResolver(zOrdenCambioAprobar),
    defaultValues: { montoAprobado: '0.0000' },
  });

  // Rechazar form
  const rechazarForm = useForm<OrdenCambioRechazarInput>({
    resolver: zodResolver(zOrdenCambioRechazar),
    defaultValues: { razonRechazo: '' },
  });

  async function onAddLinea(values: LineaOrdenCambioAddInput) {
    try {
      await addLineaMut.mutateAsync(values);
      toast.success('Línea agregada');
      lineaForm.reset();
      setShowLineaForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error agregando línea');
    }
  }

  async function onAprobar(values: OrdenCambioAprobarInput) {
    try {
      await aprobarMut.mutateAsync({ id: oc.id, input: values });
      toast.success('Orden de cambio aprobada');
      setShowAprobarForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error aprobando OC');
    }
  }

  async function onRechazar(values: OrdenCambioRechazarInput) {
    try {
      await rechazarMut.mutateAsync({ id: oc.id, input: values });
      toast.success('Orden de cambio rechazada');
      setShowRechazarForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error rechazando OC');
    }
  }

  async function handleEnviar() {
    try {
      await enviarMut.mutateAsync(oc.id);
      toast.success('OC enviada al cliente');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error enviando OC');
    }
  }

  async function handleAnular() {
    if (!confirm('¿Anular esta orden de cambio? Esta acción no se puede deshacer.')) return;
    try {
      await anularMut.mutateAsync(oc.id);
      toast.success('OC anulada');
      onBack();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error anulando OC');
    }
  }

  // Calcular impacto total de líneas
  const montoTotal = oc.lineas.reduce((sum, l) => sum.plus(new Decimal(l.montoAdicional)), new Decimal(0));

  const anyPending = enviarMut.isPending || aprobarMut.isPending || rechazarMut.isPending || anularMut.isPending;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-3"
        >
          <ArrowLeft size={14} />
          Volver a lista
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={ESTADO_BADGE[oc.estado] ?? 'default'}>{ESTADO_LABEL[oc.estado]}</Badge>
              <span className="text-xs text-gray-500">{CAUSA_LABEL[oc.causa] ?? oc.causa}</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mt-1">{oc.descripcion}</h1>
          </div>
        </div>
      </div>

      {/* Bandeja de aprobación — reutilizada de Compras */}
      <ApprovalActions
        estadoLabel={ESTADO_LABEL[oc.estado] ?? oc.estado}
        estadoBadge={ESTADO_BADGE[oc.estado] ?? 'default'}
        canEnviar={oc.estado === 'BORRADOR'}
        canAprobar={oc.estado === 'ENVIADA_CLIENTE'}
        canRechazar={oc.estado === 'ENVIADA_CLIENTE'}
        canAnular={oc.estado !== 'APROBADA' && oc.estado !== 'ANULADA'}
        isPending={anyPending}
        onEnviar={handleEnviar}
        onAprobar={() => setShowAprobarForm(true)}
        onRechazar={() => setShowRechazarForm(true)}
        onAnular={handleAnular}
        alertaReglaOro={oc.alertaReglaOro ?? undefined}
      />

      {/* KPIs de impacto */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={14} className="text-brand-500" />
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Monto solicitado</p>
          </div>
          <p className="text-xl font-bold text-gray-900 tabular-nums">
            {montoTotal.toDecimalPlaces(2).toFixed(2)}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-amber-500" />
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Días solicitados</p>
          </div>
          <p className="text-xl font-bold text-gray-900 tabular-nums">
            {oc.diasAdicionalesSolicitados != null ? `+${oc.diasAdicionalesSolicitados}d` : '—'}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <FileText size={14} className="text-green-500" />
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Monto aprobado</p>
          </div>
          <p className="text-xl font-bold text-green-700 tabular-nums">
            {oc.montoAprobado ? new Decimal(oc.montoAprobado).toFixed(2) : '—'}
          </p>
        </div>
      </div>

      {/* Líneas de cambio */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Líneas de cambio ({oc.lineas.length})</h2>
          {oc.estado === 'BORRADOR' && (
            <Button size="sm" variant="outline" onClick={() => setShowLineaForm(true)}>
              <Plus size={12} className="mr-1" />
              Agregar línea
            </Button>
          )}
        </div>
        {oc.lineas.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            Sin líneas de cambio. Agrega partidas o trabajos adicionales.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-6 py-3 font-medium">Descripción</th>
                <th className="text-left px-4 py-3 font-medium">Tipo</th>
                <th className="text-left px-4 py-3 font-medium">Impacto</th>
                <th className="text-right px-6 py-3 font-medium">Monto adicional</th>
              </tr>
            </thead>
            <tbody>
              {oc.lineas.map((linea) => (
                <tr key={linea.id} className="border-t border-gray-50">
                  <td className="px-6 py-3">
                    <span className="text-gray-900">{linea.descripcion}</span>
                    {linea.esPartidaNueva && (
                      <span className="ml-2 text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">Nueva partida</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{TIPO_IMPACTO_LABEL[linea.tipoImpacto] ?? linea.tipoImpacto}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {linea.cantidadAdicional ? `+${linea.cantidadAdicional}` : '—'}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums font-semibold text-gray-900">
                    {new Decimal(linea.montoAdicional).toFixed(2)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 bg-gray-50">
                <td colSpan={3} className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Total</td>
                <td className="px-6 py-3 text-right tabular-nums font-bold text-gray-900">
                  {montoTotal.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: Agregar línea */}
      <Modal open={showLineaForm} onClose={() => setShowLineaForm(false)} title="Agregar línea de cambio" size="md">
        <form onSubmit={lineaForm.handleSubmit(onAddLinea)} className="space-y-4">
          <FormField label="Descripción" required error={lineaForm.formState.errors.descripcion?.message}>
            <Input {...lineaForm.register('descripcion')} placeholder="Partida o trabajo adicional…" />
          </FormField>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="esPartidaNueva" {...lineaForm.register('esPartidaNueva')} className="rounded border-gray-300" />
            <label htmlFor="esPartidaNueva" className="text-sm text-gray-700">Es partida nueva (no existe en el presupuesto)</label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Tipo de impacto" required>
              <select
                {...lineaForm.register('tipoImpacto')}
                className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {TIPOS_IMPACTO.map((t) => <option key={t} value={t}>{TIPO_IMPACTO_LABEL[t]}</option>)}
              </select>
            </FormField>
            <FormField label="Cantidad adicional">
              <Input {...lineaForm.register('cantidadAdicional')} placeholder="0.0000" />
            </FormField>
          </div>
          <FormField label="Monto adicional (DOP)" required error={lineaForm.formState.errors.montoAdicional?.message}>
            <Controller
              control={lineaForm.control}
              name="montoAdicional"
              render={({ field }) => (
                <MoneyInput value={field.value} onChange={field.onChange} placeholder="0.00" />
              )}
            />
          </FormField>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowLineaForm(false)}>Cancelar</Button>
          <Button onClick={lineaForm.handleSubmit(onAddLinea)} disabled={addLineaMut.isPending}>
            {addLineaMut.isPending ? 'Agregando…' : 'Agregar línea'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal: Aprobar */}
      <Modal open={showAprobarForm} onClose={() => setShowAprobarForm(false)} title="Aprobar Orden de Cambio" size="sm">
        <form onSubmit={aprobarForm.handleSubmit(onAprobar)} className="space-y-4">
          <FormField label="Monto aprobado (DOP)" required error={aprobarForm.formState.errors.montoAprobado?.message}>
            <Controller
              control={aprobarForm.control}
              name="montoAprobado"
              render={({ field }) => (
                <MoneyInput value={field.value} onChange={field.onChange} placeholder="0.00" />
              )}
            />
          </FormField>
          <FormField label="Días adicionales aprobados">
            <Input type="number" min={0} {...aprobarForm.register('diasAdicionalesAprobados', { valueAsNumber: true })} placeholder="0" />
          </FormField>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowAprobarForm(false)}>Cancelar</Button>
          <Button onClick={aprobarForm.handleSubmit(onAprobar)} disabled={aprobarMut.isPending}>
            {aprobarMut.isPending ? 'Aprobando…' : 'Aprobar OC'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal: Rechazar */}
      <Modal open={showRechazarForm} onClose={() => setShowRechazarForm(false)} title="Rechazar Orden de Cambio" size="sm">
        <form onSubmit={rechazarForm.handleSubmit(onRechazar)} className="space-y-4">
          <FormField label="Razón del rechazo" required error={rechazarForm.formState.errors.razonRechazo?.message}>
            <textarea
              {...rechazarForm.register('razonRechazo')}
              rows={3}
              placeholder="Explica por qué se rechaza esta orden de cambio…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </FormField>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowRechazarForm(false)}>Cancelar</Button>
          <Button variant="destructive" onClick={rechazarForm.handleSubmit(onRechazar)} disabled={rechazarMut.isPending}>
            {rechazarMut.isPending ? 'Rechazando…' : 'Rechazar OC'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
