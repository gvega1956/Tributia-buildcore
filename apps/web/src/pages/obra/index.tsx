import { Navigate, Route, Routes } from 'react-router-dom';
import { NavLink } from 'react-router-dom';
import { Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ParteDiarioPage } from './partes-diarios';
import { AvanceFisicoPage } from './avance-fisico';
import { RfisPage } from './rfis';
import { PunchListPage } from './punch-list';

const NAV_ITEMS = [
  { to: 'partes-diarios', label: 'Parte Diario' },
  { to: 'avance-fisico', label: 'Avance Físico' },
  { to: 'rfis', label: 'RFI' },
  { to: 'punch-list', label: 'Punch List' },
];

function ObraLayout() {
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

export function ObraModule() {
  return (
    <Routes>
      <Route element={<ObraLayout />}>
        <Route index element={<Navigate to="partes-diarios" replace />} />
        <Route path="partes-diarios" element={<ParteDiarioPage />} />
        <Route path="avance-fisico" element={<AvanceFisicoPage />} />
        <Route path="rfis" element={<RfisPage />} />
        <Route path="punch-list" element={<PunchListPage />} />
      </Route>
    </Routes>
  );
}
