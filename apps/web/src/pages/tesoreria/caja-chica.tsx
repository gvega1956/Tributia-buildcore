import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import {
  zCrearFondoCajaChica,
  zRegistrarGastoCajaChica,
  zSolicitarReposicion,
  type CrearFondoCajaChicaInput,
  type RegistrarGastoCajaChicaInput,
  type SolicitarReposicionInput,
} from '@tributia/tesoreria';
import {
  useCrearFondoCajaChica,
  useRegistrarGastoCajaChica,
  useSolicitarReposicion,
  useEjecutarReposicion,
} from '@/hooks/use-tesoreria';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useProyectos } from '@/hooks/use-proyectos';

const TIPOS_COMPROBANTE = ['FACTURA', 'RECIBO', 'NCF', 'OTRO'] as const;

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

type PanelMode = 'crear-fondo' | 'gasto' | 'reposicion' | null;

export function CajaChicaPage() {
  const [panel, setPanel] = useState<PanelMode>(null);
  const [fondoId, setFondoId] = useState('');
  const [reposicionId, setReposicionId] = useState('');

  const { data: proyectos = [] } = useProyectos();
  const crearFondoMut = useCrearFondoCajaChica();
  const gastoMut = useRegistrarGastoCajaChica();
  const reposicionMut = useSolicitarReposicion();
  const ejecutarMut = useEjecutarReposicion();

  const fondoForm = useForm<CrearFondoCajaChicaInput>({
    resolver: zodResolver(zCrearFondoCajaChica),
    defaultValues: { empresaId: '', proyectoId: '', responsableId: '', cuentaBancariaOrigenId: '', montoAsignado: '0.0000', moneda: 'DOP' },
  });

  const gastoForm = useForm<RegistrarGastoCajaChicaInput>({
    resolver: zodResolver(zRegistrarGastoCajaChica),
    defaultValues: { empresaId: '', proyectoId: '', fecha: new Date().toISOString().slice(0, 10), monto: '0.0000', concepto: '', numeroComprobante: '', tipoComprobante: 'FACTURA', moneda: 'DOP' },
  });

  const reposicionForm = useForm<SolicitarReposicionInput>({
    resolver: zodResolver(zSolicitarReposicion),
    defaultValues: { monto: '0.0000', moneda: 'DOP' },
  });

  async function onCrearFondo(values: CrearFondoCajaChicaInput) {
    try {
      const fondo = await crearFondoMut.mutateAsync(values);
      toast.success('Fondo de caja chica creado');
      setFondoId(fondo.id);
      setPanel(null);
      fondoForm.reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error creando fondo');
    }
  }

  async function onGasto(values: RegistrarGastoCajaChicaInput) {
    if (!fondoId) { toast.error('Primero crea o selecciona un fondo'); return; }
    try {
      await gastoMut.mutateAsync({ fondoId, input: values });
      toast.success('Gasto registrado');
      setPanel(null);
      gastoForm.reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error registrando gasto');
    }
  }

  async function onReposicion(values: SolicitarReposicionInput) {
    if (!fondoId) { toast.error('Primero selecciona un fondo'); return; }
    try {
      const rep = await reposicionMut.mutateAsync({ fondoId, input: values });
      toast.success('Reposición solicitada — pasa a flujo de aprobación');
      setReposicionId(rep.id);
      setPanel(null);
      reposicionForm.reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error solicitando reposición');
    }
  }

  async function handleEjecutarReposicion() {
    if (!reposicionId) { toast.error('No hay reposición pendiente'); return; }
    try {
      await ejecutarMut.mutateAsync(reposicionId);
      toast.success('Reposición ejecutada');
      setReposicionId('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error ejecutando reposición');
    }
  }

  // Gap: no hay GET /api/v1/tesoreria/fondos-caja-chica — no se pueden listar fondos
  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Caja Chica de Obra</h1>

      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
        <span className="font-semibold">Gap #2:</span> No existe <span className="font-mono">GET /api/v1/tesoreria/fondos-caja-chica</span> — no se pueden listar fondos existentes. Las operaciones requieren conocer el fondoId.
      </div>

      {/* Fondo activo */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Fondo activo</p>
        <div className="flex items-center gap-3">
          <Input value={fondoId} onChange={(e) => setFondoId(e.target.value)} placeholder="UUID del fondo de caja chica" className="flex-1" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setPanel('crear-fondo')}>
            <Plus size={13} className="mr-1" />Crear fondo
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPanel('gasto')} disabled={!fondoId}>
            Registrar gasto
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPanel('reposicion')} disabled={!fondoId}>
            Solicitar reposición
          </Button>
          {reposicionId && (
            <Button size="sm" onClick={handleEjecutarReposicion} disabled={ejecutarMut.isPending}>
              {ejecutarMut.isPending ? 'Ejecutando…' : 'Ejecutar reposición aprobada'}
            </Button>
          )}
        </div>

        {reposicionId && (
          <p className="text-xs text-gray-500">Reposición pendiente de ejecución: <span className="font-mono">{reposicionId}</span></p>
        )}
      </div>

      {/* Modal: Crear fondo */}
      <Modal open={panel === 'crear-fondo'} onClose={() => setPanel(null)} title="Crear Fondo de Caja Chica" size="md">
        <form onSubmit={fondoForm.handleSubmit(onCrearFondo)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Empresa" required error={fondoForm.formState.errors.empresaId?.message}>
              <Input {...fondoForm.register('empresaId')} placeholder="UUID empresa" />
            </FormField>
            <FormField label="Proyecto" required error={fondoForm.formState.errors.proyectoId?.message}>
              <select {...fondoForm.register('proyectoId')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">Seleccionar…</option>
                {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Responsable ID" required error={fondoForm.formState.errors.responsableId?.message}>
              <Input {...fondoForm.register('responsableId')} placeholder="UUID usuario" />
            </FormField>
            <FormField label="Cuenta bancaria origen" required error={fondoForm.formState.errors.cuentaBancariaOrigenId?.message}>
              <Input {...fondoForm.register('cuentaBancariaOrigenId')} placeholder="UUID cuenta bancaria" />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Monto asignado" required error={fondoForm.formState.errors.montoAsignado?.message}>
              <Input {...fondoForm.register('montoAsignado')} placeholder="50000.0000" />
            </FormField>
            <FormField label="Moneda">
              <select {...fondoForm.register('moneda')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="DOP">DOP</option>
                <option value="USD">USD</option>
              </select>
            </FormField>
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setPanel(null)}>Cancelar</Button>
          <Button onClick={fondoForm.handleSubmit(onCrearFondo)} disabled={crearFondoMut.isPending}>
            {crearFondoMut.isPending ? 'Creando…' : 'Crear fondo'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal: Registrar gasto */}
      <Modal open={panel === 'gasto'} onClose={() => setPanel(null)} title="Registrar Gasto de Caja Chica" size="md">
        <form onSubmit={gastoForm.handleSubmit(onGasto)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Empresa" required><Input {...gastoForm.register('empresaId')} placeholder="UUID empresa" /></FormField>
            <FormField label="Proyecto" required>
              <select {...gastoForm.register('proyectoId')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">Seleccionar…</option>
                {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Fecha" required><Input type="date" {...gastoForm.register('fecha')} /></FormField>
            <FormField label="Monto" required error={gastoForm.formState.errors.monto?.message}><Input {...gastoForm.register('monto')} placeholder="0.0000" /></FormField>
            <FormField label="Moneda">
              <select {...gastoForm.register('moneda')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="DOP">DOP</option><option value="USD">USD</option>
              </select>
            </FormField>
          </div>
          <FormField label="Concepto" required error={gastoForm.formState.errors.concepto?.message}>
            <Input {...gastoForm.register('concepto')} placeholder="Materiales obra bloque A" />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="N° comprobante" required><Input {...gastoForm.register('numeroComprobante')} placeholder="B01-00000001" /></FormField>
            <FormField label="Tipo comprobante">
              <select {...gastoForm.register('tipoComprobante')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                {TIPOS_COMPROBANTE.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setPanel(null)}>Cancelar</Button>
          <Button onClick={gastoForm.handleSubmit(onGasto)} disabled={gastoMut.isPending}>
            {gastoMut.isPending ? 'Registrando…' : 'Registrar gasto'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Modal: Solicitar reposición */}
      <Modal open={panel === 'reposicion'} onClose={() => setPanel(null)} title="Solicitar Reposición" size="sm">
        <form onSubmit={reposicionForm.handleSubmit(onReposicion)} className="space-y-4">
          <FormField label="Monto a reponer" required error={reposicionForm.formState.errors.monto?.message}>
            <Input {...reposicionForm.register('monto')} placeholder="0.0000" autoFocus />
          </FormField>
          <FormField label="Moneda">
            <select {...reposicionForm.register('moneda')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="DOP">DOP</option><option value="USD">USD</option>
            </select>
          </FormField>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setPanel(null)}>Cancelar</Button>
          <Button onClick={reposicionForm.handleSubmit(onReposicion)} disabled={reposicionMut.isPending}>
            {reposicionMut.isPending ? 'Solicitando…' : 'Solicitar reposición'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
