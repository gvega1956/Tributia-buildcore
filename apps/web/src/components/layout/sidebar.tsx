import { NavLink } from 'react-router-dom';
import {
  FolderKanban,
  ShoppingCart,
  Package,
  HardHat,
  FileText,
  BarChart3,
  LayoutDashboard,
  Settings,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

const NAV = [
  { to: '/proyectos',    icon: FolderKanban,   label: 'Proyectos' },
  { to: '/compras',      icon: ShoppingCart,    label: 'Compras' },
  { to: '/inventario',   icon: Package,         label: 'Inventario' },
  { to: '/obra',         icon: HardHat,         label: 'Obra' },
  { to: '/cxc',          icon: FileText,        label: 'Cuentas x cobrar' },
  { to: '/tesoreria',    icon: BarChart3,        label: 'Tesorería' },
  { to: '/contabilidad', icon: LayoutDashboard,  label: 'Contabilidad' },
];

export function Sidebar() {
  const { email, tenantSlug, logout } = useAuth();

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-gray-900 text-white shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-700">
        <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-sm font-black shrink-0">
          T
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold">BuildCore</p>
          <p className="text-xs text-gray-400 truncate">{tenantSlug ?? '…'}</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-500 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white',
              )
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Pie */}
      <div className="border-t border-gray-700 px-3 py-4 space-y-0.5">
        <NavLink
          to="/configuracion"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
              isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white',
            )
          }
        >
          <Settings size={17} />
          Configuración
        </NavLink>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-red-900/50 hover:text-red-300 transition-colors"
        >
          <LogOut size={17} />
          Cerrar sesión
        </button>
        <p className="px-3 pt-2 text-xs text-gray-600 truncate">{email}</p>
      </div>
    </aside>
  );
}
