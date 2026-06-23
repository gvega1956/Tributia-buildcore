import { Navigate, Route, Routes } from 'react-router-dom';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { CubicacionesPage } from './cubicaciones';
import { FacturasClientePage } from './facturas-cliente';
import { AgingPage } from './aging';

const NAV_ITEMS = [
  { to: 'cubicaciones', label: 'Cubicaciones' },
  { to: 'facturas', label: 'Facturas cliente' },
  { to: 'aging', label: 'Cuentas x cobrar' },
];

function CxcLayout() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 bg-white px-6 shrink-0">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0',
                  isActive
                    ? 'border-brand-500 text-brand-600'
                    : 'border-transparent text-gray-500 hover:text-gray-900',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

export function CxcModule() {
  return (
    <Routes>
      <Route element={<CxcLayout />}>
        <Route index element={<Navigate to="cubicaciones" replace />} />
        <Route path="cubicaciones" element={<CubicacionesPage />} />
        <Route path="facturas" element={<FacturasClientePage />} />
        <Route path="aging" element={<AgingPage />} />
      </Route>
    </Routes>
  );
}
