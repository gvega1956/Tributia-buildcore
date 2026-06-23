import { NavLink } from 'react-router-dom';
import {
  FolderKanban,
  ShoppingCart,
  Package,
  HardHat,
  FileText,
  BarChart3,
  BookOpen,
  Settings,
  LogOut,
  FileDiff,
  LayoutDashboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

const NAV = [
  { to: '/dashboard',      icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/proyectos',      icon: FolderKanban, label: 'Proyectos' },
  { to: '/compras',        icon: ShoppingCart,  label: 'Compras' },
  { to: '/inventario',     icon: Package,       label: 'Inventario' },
  { to: '/obra',           icon: HardHat,       label: 'Obra' },
  { to: '/ordenes-cambio', icon: FileDiff,      label: 'Órdenes de Cambio' },
  { to: '/cxc',            icon: FileText,      label: 'Cuentas x cobrar' },
  { to: '/tesoreria',      icon: BarChart3,     label: 'Tesorería' },
  { to: '/contabilidad',   icon: BookOpen,      label: 'Contabilidad' },
];

export function Sidebar() {
  const { email, tenantSlug, logout } = useAuth();

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-slate-950 shrink-0 border-r border-slate-900">

      {/* ── Marca ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800/70">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-sm font-black text-white shadow-brand shrink-0">
          T
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white tracking-wide">BuildCore</p>
          <p className="text-xs text-slate-500 truncate font-medium">{tenantSlug ?? '…'}</p>
        </div>
      </div>

      {/* ── Navegación ──────────────────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-thin">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-brand-600/25 text-brand-300 ring-1 ring-inset ring-brand-500/30'
                  : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={16} className={isActive ? 'text-brand-400' : 'text-slate-500'} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Pie ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-slate-800/70 px-3 py-4 space-y-0.5">
        <NavLink
          to="/configuracion"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150',
              isActive
                ? 'bg-slate-800 text-slate-200'
                : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-300',
            )
          }
        >
          <Settings size={16} className="text-slate-600" />
          Configuración
        </NavLink>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-500 hover:bg-rose-900/30 hover:text-rose-300 transition-all duration-150"
        >
          <LogOut size={16} />
          Cerrar sesión
        </button>
        <p className="px-3 pt-2 text-[10px] text-slate-700 truncate font-medium">{email}</p>
      </div>
    </aside>
  );
}
