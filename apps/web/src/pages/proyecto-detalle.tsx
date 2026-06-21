import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, LayoutDashboard, ChevronRight, AlertCircle } from 'lucide-react';
import { TRANSICIONES_VALIDAS } from '@tributia/proyectos';
import { useProyecto, useTransicionarEstado, useTercerosClientes } from '@/hooks/use-proyectos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingScreen, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import { ESTADO_LABELS, ESTADO_BADGE, formatMoney, formatFecha } from '@/lib/proyecto-utils';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-900">{children}</dd>
    </div>
  );
}

export function ProyectoDetallePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: proyecto, isLoading, error, refetch } = useProyecto(id ?? '');
  const { data: terceros = [] } = useTercerosClientes();
  const transicion = useTransicionarEstado(id ?? '');

  if (isLoading) return <LoadingScreen />;

  if (error || !proyecto) {
    return (
      <div className="p-8">
        <ErrorState
          message="Proyecto no encontrado o sin acceso."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const nextEstado = TRANSICIONES_VALIDAS[proyecto.estado];
  const cliente = terceros.find((t) => t.id === proyecto.clienteId);

  async function handleTransicion() {
    if (!nextEstado) return;
    try {
      await transicion.mutateAsync(nextEstado);
      toast.success(`Estado avanzado a ${ESTADO_LABELS[nextEstado]}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error cambiando estado');
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <button
          onClick={() => navigate('/proyectos')}
          className="flex items-center gap-1 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft size={14} />
          Proyectos
        </button>
        <ChevronRight size={12} className="text-gray-300" />
        <span className="text-gray-900 font-medium">{proyecto.codigo}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-gray-900">{proyecto.nombre}</h1>
            <Badge variant={ESTADO_BADGE[proyecto.estado]}>
              {ESTADO_LABELS[proyecto.estado]}
            </Badge>
          </div>
          <p className="text-sm font-mono text-gray-400">{proyecto.codigo}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/proyectos/${id}/editar`)}
          >
            <Edit size={14} className="mr-1.5" />
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/proyectos/${id}/tablero`)}
          >
            <LayoutDashboard size={14} className="mr-1.5" />
            Tablero
          </Button>
        </div>
      </div>

      {/* Transición de estado */}
      {nextEstado !== null ? (
        <div className="mb-8 p-4 bg-brand-50 border border-brand-200 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-brand-800">
            <ChevronRight size={16} />
            <span>Siguiente estado: <strong>{ESTADO_LABELS[nextEstado]}</strong></span>
          </div>
          <Button
            size="sm"
            onClick={handleTransicion}
            disabled={transicion.isPending}
          >
            {transicion.isPending ? 'Procesando…' : `Avanzar a ${ESTADO_LABELS[nextEstado]}`}
          </Button>
        </div>
      ) : (
        <div className="mb-8 p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-2 text-sm text-gray-500">
          <AlertCircle size={16} />
          Proyecto en estado final — no admite más transiciones.
        </div>
      )}

      {/* Datos del proyecto */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 bg-white border border-gray-200 rounded-xl p-6">
        <Field label="Cliente">
          {cliente ? `${cliente.nombre}${cliente.rnc ? ` (${cliente.rnc})` : ''}` : proyecto.clienteId}
        </Field>
        <Field label="Tipo de obra">{proyecto.tipoObra}</Field>
        <Field label="Monto de contrato">
          {formatMoney(proyecto.montoContrato, proyecto.monedaContrato)}
        </Field>
        <Field label="Número de contrato">
          {proyecto.numeroContrato ?? '—'}
        </Field>
        <Field label="Inicio planificado">
          {formatFecha(proyecto.fechaInicioPlanificada)}
        </Field>
        <Field label="Fin planificado">
          {formatFecha(proyecto.fechaFinPlanificada)}
        </Field>
        {proyecto.fechaInicioReal && (
          <Field label="Inicio real">{formatFecha(proyecto.fechaInicioReal)}</Field>
        )}
        {proyecto.fechaFinReal && (
          <Field label="Fin real">{formatFecha(proyecto.fechaFinReal)}</Field>
        )}
        {proyecto.ubicacionDescripcion && (
          <Field label="Ubicación">
            <span className="col-span-2">{proyecto.ubicacionDescripcion}</span>
          </Field>
        )}
        {proyecto.descripcion && (
          <div className="sm:col-span-2">
            <Field label="Descripción">{proyecto.descripcion}</Field>
          </div>
        )}
      </div>

      {/* Enlace a tablero */}
      <div className="mt-6">
        <Link
          to={`/proyectos/${id}/tablero`}
          className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1"
        >
          <LayoutDashboard size={14} />
          Ver tablero de control y valor ganado →
        </Link>
      </div>
    </div>
  );
}
