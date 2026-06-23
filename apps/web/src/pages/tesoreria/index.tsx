import { Navigate, Route, Routes } from 'react-router-dom';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { BancosPage } from './bancos';
import { ConciliacionPage } from './conciliacion';
import { CajaChicaPage } from './caja-chica';
import { PagosPage } from './pagos';
import { FlujoCajaPage } from './flujo-caja';

const NAV_ITEMS = [
  { to: 'bancos', label: 'Bancos' },
  { to: 'conciliacion', label: 'Conciliación' },
  { to: 'caja-chica', label: 'Caja Chica' },
  { to: 'pagos', label: 'Pagos' },
  { to: 'flujo-caja', label: 'Flujo de Caja' },
];

function TesoreriaLayout() {
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

export function TesoreriaModule() {
  return (
    <Routes>
      <Route element={<TesoreriaLayout />}>
        <Route index element={<Navigate to="bancos" replace />} />
        <Route path="bancos" element={<BancosPage />} />
        <Route path="conciliacion" element={<ConciliacionPage />} />
        <Route path="caja-chica" element={<CajaChicaPage />} />
        <Route path="pagos" element={<PagosPage />} />
        <Route path="flujo-caja" element={<FlujoCajaPage />} />
      </Route>
    </Routes>
  );
}
