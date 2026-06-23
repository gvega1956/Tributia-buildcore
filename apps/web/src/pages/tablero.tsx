import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  X,
  ExternalLink,
  RefreshCw,
  Activity,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import Decimal from 'decimal.js';
import { cn } from '@/lib/utils';
import {
  useTablero,
  useCurvaS,
  useTrazabilidad,
  type TableroPartidaRow,
  type AlertaTablero,
} from '@/hooks/use-tablero';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';

// ─── Utilidades de formato (sin cambios de lógica) ───────────────────────────

function fmt(val: string | null | undefined, decimals = 2) {
  if (val == null) return '—';
  return new Intl.NumberFormat('es-DO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(parseFloat(val));
}

function fmtMoney(val: string | null | undefined) {
  if (val == null) return '—';
  const n = parseFloat(val);
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1_000_000) s = `${(n / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) s = `${(n / 1_000).toFixed(0)}K`;
  else s = n.toFixed(0);
  return `$${s}`;
}

function fmtMoneyFull(val: string | null | undefined) {
  if (val == null) return '—';
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(parseFloat(val));
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

// ─── Helpers de alerta (clases actualizadas, lógica idéntica) ────────────────

function alertaBg(alerta: AlertaTablero): string {
  if (alerta === 'ROJO')     return 'bg-rose-50/70 border-l-4 border-l-rose-500';
  if (alerta === 'AMARILLO') return 'bg-amber-50/70 border-l-4 border-l-amber-400';
  return '';
}

function alertaRowText(alerta: AlertaTablero): string {
  if (alerta === 'ROJO') return 'text-rose-700 font-semibold';
  return '';
}

function AlertaIcon({ alerta, size = 16 }: { alerta: AlertaTablero; size?: number }) {
  if (alerta === 'VERDE')    return <CheckCircle  size={size} className="text-emerald-500 shrink-0" />;
  if (alerta === 'AMARILLO') return <AlertCircle  size={size} className="text-amber-500 shrink-0" />;
  return                            <AlertTriangle size={size} className="text-rose-500 shrink-0" />;
}

function cpiVariant(cpi: string | null): 'success' | 'warning' | 'danger' | 'default' {
  if (cpi == null) return 'default';
  const v = parseFloat(cpi);
  if (v >= 0.95) return 'success';
  if (v >= 0.80) return 'warning';
  return 'danger';
}

// ─── Encabezado de sección ───────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-5 w-[3px] rounded-full bg-brand-500 shrink-0" />
      <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.12em]">{label}</h2>
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

type KpiAccent = 'brand' | 'amber' | 'sky' | 'emerald' | 'rose' | 'slate';

const ACCENT_CLS: Record<KpiAccent, string> = {
  brand:   'border-l-brand-500 bg-brand-50/30',
  amber:   'border-l-amber-500 bg-amber-50/40',
  sky:     'border-l-sky-500 bg-sky-50/40',
  emerald: 'border-l-emerald-500 bg-emerald-50/40',
  rose:    'border-l-rose-500 bg-rose-50/40',
  slate:   'border-l-slate-200 bg-white',
};

function KpiCard({
  label, value, sub, color, trend, bar, barColor, barMax, accent = 'slate',
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  trend?: 'up' | 'down' | null;
  bar?: number;
  barColor?: string;
  barMax?: number;
  accent?: KpiAccent;
}) {
  const pct = (bar !== undefined && barMax !== undefined && barMax > 0)
    ? Math.min(100, (bar / barMax) * 100)
    : 0;

  return (
    <div
      className={cn(
        'rounded-xl border-l-4 border border-slate-200 shadow-card p-5 space-y-2.5 card-hover',
        ACCENT_CLS[accent],
      )}
    >
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em]">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <p className={cn('text-4xl font-extrabold num leading-none', color ?? 'text-slate-900')}>{value}</p>
        {trend === 'up'   && <TrendingUp   size={18} className="text-emerald-500 shrink-0 mb-1" />}
        {trend === 'down' && <TrendingDown size={18} className="text-rose-500 shrink-0 mb-1" />}
      </div>
      {sub && (
        <p className="text-xs text-slate-400 font-medium leading-tight">{sub}</p>
      )}
      {bar !== undefined && barMax !== undefined && (
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-700', barColor ?? 'bg-brand-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Tarjeta EVM — dark card de alto impacto ─────────────────────────────────

function EvmCard({ cpi, spi, ev, ac }: {
  cpi: string | null;
  spi: string | null;
  ev: string;
  ac: string;
}) {
  const cpiNum = cpi ? parseFloat(cpi) : null;
  const spiNum = spi ? parseFloat(spi) : null;

  const indexBg = (v: number | null) =>
    v == null      ? 'bg-slate-800/60' :
    v >= 0.95      ? 'bg-emerald-950/80 border border-emerald-800/50' :
    v >= 0.80      ? 'bg-amber-950/80 border border-amber-800/50' :
                     'bg-rose-950/80 border border-rose-800/50';

  const indexColor = (v: number | null) =>
    v == null ? 'text-slate-500' :
    v >= 0.95 ? 'text-emerald-300' :
    v >= 0.80 ? 'text-amber-300' :
               'text-rose-300';

  const indexTrend = (v: number | null) =>
    v == null ? null :
    v >= 0.95 ? <TrendingUp size={15} className="text-emerald-400 shrink-0" /> :
               <TrendingDown size={15} className={v >= 0.80 ? 'text-amber-400 shrink-0' : 'text-rose-400 shrink-0'} />;

  return (
    <div className="bg-slate-950 rounded-xl border border-slate-800 shadow-card-lg p-5 space-y-4">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.12em]">
        Valor Ganado — EVM
      </p>

      <div className="grid grid-cols-2 gap-3">
        {/* CPI */}
        <div className={cn('p-4 rounded-xl', indexBg(cpiNum))}>
          <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-2.5">
            CPI · Costo
          </p>
          <div className="flex items-center gap-2 mb-1">
            {indexTrend(cpiNum)}
            <span className={cn('text-3xl font-extrabold num leading-none', indexColor(cpiNum))}>
              {cpi ? fmt(cpi, 2) : '—'}
            </span>
          </div>
          <p className="text-[9px] text-slate-600">≥1.0 bajo presupuesto</p>
        </div>

        {/* SPI */}
        <div className={cn('p-4 rounded-xl', indexBg(spiNum))}>
          <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-2.5">
            SPI · Tiempo
          </p>
          <div className="flex items-center gap-2 mb-1">
            {indexTrend(spiNum)}
            <span className={cn('text-3xl font-extrabold num leading-none', indexColor(spiNum))}>
              {spi ? fmt(spi, 2) : '—'}
            </span>
          </div>
          <p className="text-[9px] text-slate-600">≥1.0 a tiempo o adelantado</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-4">
        <div>
          <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">EV Ganado</p>
          <p className="text-sm font-bold num text-slate-200">{fmtMoneyFull(ev)}</p>
        </div>
        <div>
          <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">AC Costo Real</p>
          <p className="text-sm font-bold num text-slate-200">{fmtMoneyFull(ac)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Tooltip personalizado Curva S ───────────────────────────────────────────

const CurvaSTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-950 border border-slate-700 shadow-card-lg rounded-xl px-4 py-3 text-xs space-y-1.5">
      <p className="font-semibold text-slate-300">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="font-bold text-white num">
            {new Intl.NumberFormat('es-DO', { maximumFractionDigits: 0 }).format(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── Gráfico Curva S ─────────────────────────────────────────────────────────

function CurvaSChart({ proyectoId }: { proyectoId: string }) {
  const { data: puntos = [], isLoading, error, refetch } = useCurvaS(proyectoId);

  if (isLoading) return <div className="flex items-center justify-center h-56"><LoadingSpinner /></div>;
  if (error)     return <ErrorState message="Error cargando curva S" onRetry={() => refetch()} />;
  if (puntos.length === 0) return (
    <EmptyState
      title="Sin datos de curva S"
      description="Registra avances y consumos para ver la evolución del proyecto."
    />
  );

  // lógica de transformación intacta
  const chartData = puntos.map((p) => ({
    semana: p.semana.slice(5),
    'EV acumulado': parseFloat(p.evAcumulado),
    'AC acumulado': parseFloat(p.acAcumulado),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradEV" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10B981" stopOpacity={0.30} />
            <stop offset="95%" stopColor="#10B981" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gradAC" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#F59E0B" stopOpacity={0.30} />
            <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="semana" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
        />
        <Tooltip content={<CurvaSTooltip />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
        <Area type="monotone" dataKey="EV acumulado" stroke="#10B981" strokeWidth={2.5} fill="url(#gradEV)" dot={false} />
        <Area type="monotone" dataKey="AC acumulado" stroke="#F59E0B" strokeWidth={2.5} fill="url(#gradAC)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Panel trazabilidad (drawer lateral) ────────────────────────────────────

const TIPO_EVENTO_LABEL: Record<string, string> = {
  consumo_material:  'Consumo material',
  avance_obra:       'Avance de obra',
  recepcion_oc:      'Recepción de OC',
  emision_oc:        'Emisión de OC',
  orden_cambio:      'Orden de cambio',
  pago_emitido:      'Pago emitido',
  factura_proveedor: 'Factura proveedor',
};

function TrazabilidadPanel({
  partida,
  onClose,
}: {
  partida: TableroPartidaRow;
  onClose: () => void;
}) {
  const { data: eventos = [], isLoading, error, refetch } = useTrazabilidad(partida.partidaId);

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      {/* Overlay */}
      <div className="flex-1 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-lg bg-white h-full shadow-card-lg flex flex-col overflow-hidden animate-slide-in-right">

        {/* Cabecera con gradiente brand */}
        <div className="px-6 py-5 flex items-start justify-between shrink-0 bg-gradient-to-r from-brand-600 to-brand-700">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertaIcon alerta={partida.alerta} size={13} />
              <p className="text-xs font-mono text-brand-200">{partida.codigo}</p>
            </div>
            <p className="font-bold text-white leading-snug text-base">{partida.nombre}</p>
            <p className="text-xs text-brand-200/70 mt-0.5">
              Trazabilidad P8 — eventos operativos vinculados
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/50 hover:bg-white/15 hover:text-white transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* KPIs del registro */}
        <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 shrink-0 bg-slate-50">
          <div className="px-5 py-4">
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-bold mb-1.5">Devengado</p>
            <p className="text-lg font-extrabold num text-sky-700">{fmtMoney(partida.devengado)}</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-bold mb-1.5">Disponible</p>
            <p className={cn(
              'text-lg font-extrabold num',
              parseFloat(partida.disponible) < 0 ? 'text-rose-600' : 'text-emerald-700',
            )}>
              {fmtMoney(partida.disponible)}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-bold mb-1.5">CPI</p>
            <Badge variant={cpiVariant(partida.cpi)} dot className="text-xs">
              {partida.cpi ? fmt(partida.cpi, 2) : '—'}
            </Badge>
          </div>
        </div>

        {/* Lista de eventos (lógica intacta) */}
        <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
          {isLoading && <LoadingSpinner />}
          {error && (
            <ErrorState message="Error cargando trazabilidad" onRetry={() => refetch()} />
          )}
          {!isLoading && !error && eventos.length === 0 && (
            <EmptyState
              title="Sin eventos registrados"
              description="No hay eventos operativos vinculados a esta partida todavía."
            />
          )}
          {eventos.length > 0 && (
            <ol className="relative border-l-2 border-slate-100 space-y-1 pl-1">
              {eventos.map((ev, i) => (
                <li key={ev.eventoId} className="ml-5 pb-4">
                  <span
                    className="absolute -left-[9px] flex items-center justify-center w-4 h-4 rounded-full bg-brand-100 border-2 border-white"
                    style={{ marginTop: '2px' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                  </span>

                  <div className="bg-white rounded-xl p-3.5 space-y-2 border border-slate-100 shadow-card hover:border-brand-200 hover:shadow-card-md transition-all duration-150">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">
                        {TIPO_EVENTO_LABEL[ev.tipoEvento] ?? ev.tipoEvento}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {fmtDate(ev.ocurridoEn)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
                      <span className="text-slate-300">evt</span>
                      <span>{ev.eventoId.slice(0, 20)}…</span>
                    </div>

                    {ev.referenciaTabla && ev.referenciaId && (
                      <div className="flex items-center gap-1.5 text-[10px] text-brand-600 font-medium">
                        <ExternalLink size={10} />
                        <span className="font-mono">{ev.referenciaTabla}</span>
                        <ChevronRight size={10} className="text-slate-300" />
                        <span className="font-mono">{ev.referenciaId.slice(0, 14)}…</span>
                      </div>
                    )}
                  </div>

                  {i < eventos.length - 1 && (
                    <div className="ml-[-1px] mt-1 h-3 border-l-2 border-dashed border-slate-100" />
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tabla Tríada por partida ─────────────────────────────────────────────────

function TriadaTable({
  partidas,
  onPartidaClick,
}: {
  partidas: TableroPartidaRow[];
  onPartidaClick: (p: TableroPartidaRow) => void;
}) {
  const alertas = partidas.filter((p) => p.alerta !== 'VERDE');

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-900">Tríada por partida</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {partidas.length} partidas · clic para ver trazabilidad P8
          </p>
        </div>
        <div className="flex items-center gap-2">
          {alertas.filter((a) => a.alerta === 'ROJO').length > 0 && (
            <Badge variant="danger" dot>
              {alertas.filter((a) => a.alerta === 'ROJO').length} críticas
            </Badge>
          )}
          {alertas.filter((a) => a.alerta === 'AMARILLO').length > 0 && (
            <Badge variant="warning" dot>
              {alertas.filter((a) => a.alerta === 'AMARILLO').length} atención
            </Badge>
          )}
        </div>
      </div>

      {partidas.length === 0 ? (
        <div className="p-8">
          <EmptyState
            title="Sin partidas"
            description="Este proyecto no tiene partidas en el presupuesto vigente."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-slate-900">
                <th className="text-left px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Partida</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold text-slate-300 uppercase tracking-widest">Vigente</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold text-amber-400 uppercase tracking-widest">Comprometido</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold text-sky-400 uppercase tracking-widest">Devengado</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold text-slate-300 uppercase tracking-widest">Disponible</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold text-slate-300 uppercase tracking-widest">Avance</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold text-slate-300 uppercase tracking-widest">CPI</th>
                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-300 uppercase tracking-widest">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {partidas.map((p, idx) => {
                // cálculos de porcentaje intactos
                const vigente = parseFloat(p.presupuestoVigente);
                const comprometidoPct = vigente > 0 ? (parseFloat(p.comprometido) / vigente) * 100 : 0;
                const devengadoPct   = vigente > 0 ? (parseFloat(p.devengado)   / vigente) * 100 : 0;

                return (
                  <tr
                    key={p.partidaId}
                    onClick={() => onPartidaClick(p)}
                    className={cn(
                      'border-t border-slate-100 cursor-pointer group transition-colors duration-100',
                      idx % 2 !== 0 ? 'bg-slate-50/40' : 'bg-white',
                      'hover:bg-brand-50/50',
                      alertaBg(p.alerta),
                    )}
                  >
                    <td className="px-6 py-3">
                      <div style={{ paddingLeft: Math.max(0, p.nivel - 1) * 16 }}>
                        <p className="font-mono text-[10px] text-slate-400">{p.numeroJerarquico}</p>
                        <p className={cn(
                          'font-medium leading-snug',
                          alertaRowText(p.alerta) || 'text-slate-800',
                        )}>
                          {p.nombre}
                        </p>
                        {/* mini barras indicadoras (comprometido / devengado) */}
                        <div className="mt-1.5 space-y-0.5 w-28">
                          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400 rounded-full"
                              style={{ width: `${Math.min(100, comprometidoPct)}%` }}
                            />
                          </div>
                          <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-sky-500 rounded-full"
                              style={{ width: `${Math.min(100, devengadoPct)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right num font-semibold text-slate-700">
                      {fmtMoney(p.presupuestoVigente)}
                    </td>
                    <td className="px-4 py-3 text-right num text-amber-600 font-medium">
                      {fmtMoney(p.comprometido)}
                    </td>
                    <td className="px-4 py-3 text-right num text-sky-600 font-medium">
                      {fmtMoney(p.devengado)}
                    </td>
                    <td className={cn(
                      'px-4 py-3 text-right num font-bold',
                      parseFloat(p.disponible) < 0 ? 'text-rose-600' : 'text-emerald-700',
                    )}>
                      {fmtMoney(p.disponible)}
                    </td>
                    <td className="px-4 py-3 text-right num text-slate-600">
                      {fmt(p.avancePct, 1)}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.cpi
                        ? <Badge variant={cpiVariant(p.cpi)} className="text-xs">{fmt(p.cpi, 2)}</Badge>
                        : <span className="text-slate-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-center">
                      <AlertaIcon alerta={p.alerta} size={15} />
                    </td>
                    <td className="px-3 py-3">
                      <ChevronRight
                        size={14}
                        className="text-slate-300 group-hover:text-brand-500 transition-colors"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Página Tablero de Control ────────────────────────────────────────────────

export function TablEroPage() {
  // ── lógica intacta ──────────────────────────────────────────────────────────
  const { id = '' } = useParams();
  const [selectedPartida, setSelectedPartida] = useState<TableroPartidaRow | null>(null);

  const { data: tablero, isLoading, error, refetch } = useTablero(id);

  const vigente    = tablero ? parseFloat(tablero.presupuestoVigente) : 0;
  const disponible = tablero ? parseFloat(tablero.disponible) : 0;
  const avancePct  = tablero ? parseFloat(tablero.avancePct) : 0;

  const alertasActivas = tablero?.partidas.filter((p) => p.alerta !== 'VERDE') ?? [];
  // ── fin lógica ──────────────────────────────────────────────────────────────

  const headerAlertaCls =
    tablero?.alerta === 'VERDE'    ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/35' :
    tablero?.alerta === 'AMARILLO' ? 'bg-amber-500/20  text-amber-300  ring-1 ring-amber-500/35' :
                                     'bg-rose-500/20   text-rose-300   ring-1 ring-rose-500/35';

  const headerAlertaLabel =
    tablero?.alerta === 'VERDE'    ? 'En control' :
    tablero?.alerta === 'AMARILLO' ? 'Atención requerida' :
                                     'Alerta crítica';

  const donutColor =
    avancePct >= 75 ? '#10B981' :
    avancePct >= 40 ? '#F59E0B' :
                      '#6366F1';

  return (
    <div className="min-h-full bg-slate-100">

      {/* ── Barra superior oscura ───────────────────────────────────────── */}
      <div className="bg-slate-950 sticky top-0 z-20 shadow-xl">
        <div className="max-w-screen-2xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to={`/proyectos/${id}`}
              className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors text-sm"
            >
              <ChevronLeft size={16} />
              Proyecto
            </Link>
            <span className="text-slate-700 select-none">·</span>
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-brand-400" />
              <h1 className="text-white font-bold text-sm tracking-wide">Tablero de Control</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {tablero && (
              <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold', headerAlertaCls)}>
                <AlertaIcon alerta={tablero.alerta} size={12} />
                {headerAlertaLabel}
              </div>
            )}
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>
        </div>
      </div>

      {/* ── Contenido ─────────────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto px-6 py-8 space-y-10">

        {/* Loading / Error */}
        {isLoading && !tablero && (
          <div className="flex items-center justify-center h-64">
            <LoadingSpinner />
          </div>
        )}
        {error && !tablero && (
          <ErrorState
            message={error instanceof Error ? error.message : 'Error cargando tablero'}
            onRetry={() => refetch()}
          />
        )}

        {tablero && (
          <>
            {/* ── S1: Tríada financiera ──────────────────────────────────── */}
            <section>
              <SectionHeader label="Presupuesto" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard
                  label="Vigente"
                  value={fmtMoney(tablero.presupuestoVigente)}
                  sub={fmtMoneyFull(tablero.presupuestoVigente)}
                  accent="slate"
                />
                <KpiCard
                  label="Comprometido"
                  value={fmtMoney(tablero.comprometido)}
                  sub={`${vigente > 0 ? ((parseFloat(tablero.comprometido) / vigente) * 100).toFixed(0) : 0}% del vigente`}
                  color="text-amber-600"
                  accent="amber"
                  bar={parseFloat(tablero.comprometido)}
                  barMax={vigente}
                  barColor="bg-amber-400"
                />
                <KpiCard
                  label="Devengado"
                  value={fmtMoney(tablero.devengado)}
                  sub={`${vigente > 0 ? ((parseFloat(tablero.devengado) / vigente) * 100).toFixed(0) : 0}% del vigente`}
                  color="text-sky-600"
                  accent="sky"
                  bar={parseFloat(tablero.devengado)}
                  barMax={vigente}
                  barColor="bg-sky-500"
                />
                <KpiCard
                  label="Disponible"
                  value={fmtMoney(tablero.disponible)}
                  sub={
                    disponible < 0
                      ? '⚠ Por encima del presupuesto'
                      : `${vigente > 0 ? ((disponible / vigente) * 100).toFixed(0) : 0}% libre`
                  }
                  color={disponible < 0 ? 'text-rose-600' : 'text-emerald-700'}
                  accent={disponible < 0 ? 'rose' : 'emerald'}
                  trend={disponible < 0 ? 'down' : 'up'}
                />
              </div>
            </section>

            {/* ── S2: Avance físico + EVM + Curva S preview ─────────────── */}
            <section>
              <SectionHeader label="Valor Ganado" />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* Avance físico: donut grande */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 space-y-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em]">
                    Avance Físico
                  </p>

                  <div className="flex items-center justify-center py-2">
                    <div className="relative flex items-center justify-center w-40 h-40">
                      <svg viewBox="0 0 36 36" className="w-40 h-40 -rotate-90">
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f1f5f9" strokeWidth="3.2" />
                        <circle
                          cx="18" cy="18" r="15.9" fill="none"
                          stroke={donutColor}
                          strokeWidth="3.2"
                          strokeDasharray={`${(avancePct / 100) * 100} ${100 - (avancePct / 100) * 100}`}
                          strokeLinecap="round"
                          className="transition-all duration-700"
                        />
                      </svg>
                      <div className="absolute text-center">
                        <p className="text-5xl font-black text-slate-900 num leading-none">
                          {fmt(tablero.avancePct, 0)}
                        </p>
                        <p className="text-sm text-slate-400 font-bold mt-0.5">%</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between text-xs text-slate-500 border-t border-slate-100 pt-3">
                    <span>EV: <span className="font-bold text-slate-900 num">{fmtMoney(tablero.ev)}</span></span>
                    <span>AC: <span className="font-bold text-slate-900 num">{fmtMoney(tablero.ac)}</span></span>
                  </div>
                </div>

                {/* EVM — dark card */}
                <EvmCard cpi={tablero.cpi} spi={tablero.spi} ev={tablero.ev} ac={tablero.ac} />

                {/* Curva S preview */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 space-y-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em]">
                    Curva S — Vista previa
                  </p>
                  <CurvaSChart proyectoId={id} />
                </div>
              </div>
            </section>

            {/* ── S3: Curva S expandida ──────────────────────────────────── */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-card p-6 space-y-4">
              <div>
                <h2 className="font-bold text-slate-900">Curva S — Programado vs. Ejecutado</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  EV acumulado (verde) vs. AC costo real acumulado (ámbar)
                </p>
              </div>
              <CurvaSChart proyectoId={id} />
              <div className="flex gap-6 text-[10px] text-slate-400 border-t border-slate-50 pt-3">
                <span>
                  <span className="inline-block w-3 h-2 bg-emerald-400 rounded-sm mr-1" />
                  EV ≥ AC: proyecto bajo presupuesto (CPI ≥ 1)
                </span>
                <span>
                  <span className="inline-block w-3 h-2 bg-amber-400 rounded-sm mr-1" />
                  AC ≥ EV: proyecto sobre costo (CPI &lt; 1)
                </span>
              </div>
            </section>

            {/* ── S4: Alertas activas ────────────────────────────────────── */}
            {alertasActivas.length > 0 && (
              <section>
                <SectionHeader label={`Alertas activas — ${alertasActivas.length}`} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {alertasActivas.slice(0, 6).map((p) => (
                    <button
                      key={p.partidaId}
                      onClick={() => setSelectedPartida(p)}
                      className={cn(
                        'flex items-center gap-3 p-4 rounded-xl border text-left w-full transition-all hover:shadow-card-md hover:-translate-y-px',
                        p.alerta === 'ROJO'
                          ? 'bg-rose-50 border-l-4 border-rose-200 border-l-rose-500 hover:border-rose-300'
                          : 'bg-amber-50 border-l-4 border-amber-200 border-l-amber-500 hover:border-amber-300',
                      )}
                    >
                      <AlertaIcon alerta={p.alerta} size={18} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 truncate">{p.nombre}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Disponible:{' '}
                          <span className={cn(
                            'font-bold num',
                            parseFloat(p.disponible) < 0 ? 'text-rose-600' : 'text-amber-700',
                          )}>
                            {fmtMoney(p.disponible)}
                          </span>
                          {p.cpi && (
                            <span> · CPI: <span className="font-bold num">{fmt(p.cpi, 2)}</span></span>
                          )}
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-slate-300 shrink-0" />
                    </button>
                  ))}
                </div>
                {alertasActivas.length > 6 && (
                  <p className="text-xs text-slate-400 text-center mt-3">
                    +{alertasActivas.length - 6} más en la tabla de partidas
                  </p>
                )}
              </section>
            )}

            {/* ── S5: Tríada completa ────────────────────────────────────── */}
            <section>
              <SectionHeader label="Tríada por partida" />
              <TriadaTable
                partidas={tablero.partidas}
                onPartidaClick={setSelectedPartida}
              />
            </section>
          </>
        )}
      </div>

      {/* Panel de trazabilidad */}
      {selectedPartida && (
        <TrazabilidadPanel
          partida={selectedPartida}
          onClose={() => setSelectedPartida(null)}
        />
      )}
    </div>
  );
}
