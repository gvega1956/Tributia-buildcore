import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Activity,
  Building2,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useKPIsCartera,
  useSaludProyectos,
  useFeedActividad,
  type AlertaCartera,
  type SaludProyecto,
  type ActividadItem,
} from '@/hooks/use-dashboard-ejecutivo';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';

// ── Etiquetas de tipo de evento ──────────────────────────────────────────────

const TIPO_EVENTO_LABELS: Record<string, string> = {
  recepcion_oc: 'Recepción OC',
  parte_diario: 'Parte Diario',
  factura_proveedor: 'Factura Proveedor',
  cubicacion_aprobada: 'Cubicación Aprobada',
  pago_emitido: 'Pago Emitido',
  orden_cambio_aprobada: 'Orden de Cambio',
  consumo_material: 'Consumo Material',
};

function labelEvento(tipo: string) {
  return TIPO_EVENTO_LABELS[tipo] ?? tipo;
}

// ── Helpers de alerta ────────────────────────────────────────────────────────

function AlertaIcon({ alerta, size = 15 }: { alerta: AlertaCartera; size?: number }) {
  if (alerta === 'VERDE')    return <CheckCircle  size={size} className="text-emerald-500 shrink-0" />;
  if (alerta === 'AMARILLO') return <AlertCircle  size={size} className="text-amber-500 shrink-0" />;
  return                            <AlertTriangle size={size} className="text-rose-500 shrink-0" />;
}

function alertaBadgeCls(alerta: AlertaCartera) {
  if (alerta === 'VERDE')    return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (alerta === 'AMARILLO') return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-rose-50 text-rose-700 ring-rose-200';
}

function indexColor(v: number | null) {
  if (v == null) return 'text-slate-400';
  if (v >= 0.95) return 'text-emerald-600';
  if (v >= 0.80) return 'text-amber-600';
  return 'text-rose-600';
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, trend, accent = 'slate',
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | null;
  accent?: 'brand' | 'amber' | 'rose' | 'emerald' | 'slate';
}) {
  const accentCls = {
    brand:   'border-l-brand-500 bg-brand-50/30',
    amber:   'border-l-amber-500 bg-amber-50/40',
    rose:    'border-l-rose-500 bg-rose-50/40',
    emerald: 'border-l-emerald-500 bg-emerald-50/40',
    slate:   'border-l-slate-200 bg-white',
  }[accent];

  return (
    <div
      className={cn(
        'rounded-xl border-l-4 border border-slate-200 shadow-sm p-5 space-y-2.5',
        accentCls,
      )}
    >
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em]">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <p className="text-3xl font-extrabold leading-none text-slate-900">{value}</p>
        {trend === 'up'   && <TrendingUp   size={18} className="text-emerald-500 shrink-0 mb-1" />}
        {trend === 'down' && <TrendingDown size={18} className="text-rose-500 shrink-0 mb-1" />}
      </div>
      {sub && <p className="text-xs text-slate-400 font-medium">{sub}</p>}
    </div>
  );
}

// ── Tarjeta de salud de un proyecto ──────────────────────────────────────────

function ProyectoSaludCard({ p }: { p: SaludProyecto }) {
  const cpiNum = p.cpi != null ? parseFloat(p.cpi) : null;
  const spiNum = p.spi != null ? parseFloat(p.spi) : null;
  const avance = parseFloat(p.avancePct);

  return (
    <Link
      to={`/proyectos/${p.proyectoId}/tablero`}
      className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-400 hover:shadow-md transition-all"
    >
      {/* encabezado */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400 font-mono mb-0.5">{p.codigo}</p>
          <p className="text-sm font-semibold text-slate-800 leading-tight truncate">{p.nombre}</p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 shrink-0',
            alertaBadgeCls(p.alerta),
          )}
        >
          <AlertaIcon alerta={p.alerta} size={11} />
          {p.alerta}
        </span>
      </div>

      {/* indicadores EVM */}
      <div className="flex gap-3 mb-3">
        <div className="flex-1">
          <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">CPI</p>
          <p className={cn('text-lg font-extrabold leading-none', indexColor(cpiNum))}>
            {cpiNum != null ? cpiNum.toFixed(2) : '—'}
          </p>
        </div>
        <div className="flex-1">
          <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">SPI</p>
          <p className={cn('text-lg font-extrabold leading-none', indexColor(spiNum))}>
            {spiNum != null ? spiNum.toFixed(2) : '—'}
          </p>
        </div>
        <div className="flex-1">
          <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-0.5">Avance</p>
          <p className="text-lg font-extrabold leading-none text-slate-700">{avance.toFixed(1)}%</p>
        </div>
      </div>

      {/* barra de avance */}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-700"
          style={{ width: `${Math.min(100, avance)}%` }}
        />
      </div>
    </Link>
  );
}

// ── Fila de actividad ─────────────────────────────────────────────────────────

function ActividadRow({ item }: { item: ActividadItem }) {
  const fecha = new Date(item.ocurridoEn).toLocaleDateString('es-DO', {
    day: '2-digit', month: 'short', year: '2-digit',
  });

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
        <Activity size={13} className="text-slate-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-700">{labelEvento(item.tipoEvento)}</p>
        <p className="text-[11px] text-slate-400 truncate">{item.proyectoNombre}</p>
      </div>
      <p className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">{fecha}</p>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export function DashboardEjecutivoPage() {
  const kpis     = useKPIsCartera();
  const salud    = useSaludProyectos();
  const actividad = useFeedActividad();

  const kData = kpis.data;

  const cpiNum = kData?.cpiPromedioPonderado != null
    ? parseFloat(kData.cpiPromedioPonderado)
    : null;

  const enAlerta = kData != null
    ? (kData.proyectosEnRojo + kData.proyectosEnAmarillo)
    : null;

  return (
    <div className="p-6 space-y-8 max-w-[1400px] mx-auto">

      {/* ── Encabezado ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <BarChart3 size={22} className="text-brand-500 shrink-0" />
        <h1 className="text-xl font-bold text-slate-900">Dashboard Ejecutivo</h1>
      </div>

      {/* ── KPIs de cartera ──────────────────────────────────────────────────── */}
      <section aria-label="KPIs de cartera">
        {kpis.isLoading && !kData ? (
          <LoadingSpinner />
        ) : kpis.error ? (
          <ErrorState message="No se pudo cargar los KPIs." onRetry={() => kpis.refetch()} />
        ) : kData ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Proyectos Activos"
              value={String(kData.totalProyectosActivos)}
              sub={`${kData.proyectosEnVerde} en verde`}
              accent="brand"
            />
            <KpiCard
              label="Cartera Total"
              value={fmtMoneyShort(kData.montoTotalCartera)}
              sub={kData.monedaBase}
              accent="slate"
            />
            <KpiCard
              label="En Alerta"
              value={enAlerta != null ? String(enAlerta) : '—'}
              sub={`${kData.proyectosEnRojo} críticos`}
              accent={kData.proyectosEnRojo > 0 ? 'rose' : 'amber'}
              trend={kData.proyectosEnRojo > 0 ? 'down' : null}
            />
            <KpiCard
              label="CPI Promedio"
              value={cpiNum != null ? cpiNum.toFixed(2) : '—'}
              sub="Cost Performance Index"
              accent={cpiNum != null && cpiNum >= 0.95 ? 'emerald' : 'amber'}
              trend={cpiNum != null ? (cpiNum >= 1 ? 'up' : 'down') : null}
            />
          </div>
        ) : null}
      </section>

      {/* ── Grid de salud + Feed de actividad ────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">

        {/* Salud de proyectos */}
        <section aria-label="Salud de proyectos">
          <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-4">
            Salud de Proyectos
          </h2>

          {salud.isLoading ? (
            <LoadingSpinner />
          ) : salud.error ? (
            <ErrorState message="No se pudo cargar la salud de proyectos." onRetry={() => salud.refetch()} />
          ) : !salud.data?.length ? (
            <EmptyState
              icon={<Building2 size={40} />}
              title="Sin proyectos activos"
              description="Los proyectos en ejecución aparecerán aquí."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {salud.data.map((p) => (
                <ProyectoSaludCard key={p.proyectoId} p={p} />
              ))}
            </div>
          )}
        </section>

        {/* Feed de actividad */}
        <section aria-label="Actividad reciente">
          <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-4">
            Actividad Reciente
          </h2>

          {actividad.isLoading ? (
            <LoadingSpinner />
          ) : actividad.error ? (
            <ErrorState message="No se pudo cargar la actividad." onRetry={() => actividad.refetch()} />
          ) : !actividad.data?.length ? (
            <EmptyState title="Sin actividad reciente" />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-1">
              {actividad.data.map((item) => (
                <ActividadRow key={item.eventoId} item={item} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Util ──────────────────────────────────────────────────────────────────────

function fmtMoneyShort(val: string | null | undefined): string {
  if (val == null) return '—';
  const n = parseFloat(val);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
