import { Navigate, Route, Routes } from 'react-router-dom';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { LibroDiarioPage } from './libro-diario';
import { LibroMayorPage } from './libro-mayor';
import { BalanzaPage } from './balanza';
import { EstadosFinancierosPage } from './estados-financieros';
import { AsientoAjustePage } from './asiento-ajuste';

const NAV_ITEMS = [
  { to: 'libro-diario', label: 'Libro Diario' },
  { to: 'libro-mayor', label: 'Libro Mayor' },
  { to: 'balanza', label: 'Balanza' },
  { to: 'estados', label: 'Estados Financieros' },
  { to: 'ajuste', label: 'Asiento Ajuste' },
];

function ContabilidadLayout() {
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

export function ContabilidadModule() {
  return (
    <Routes>
      <Route element={<ContabilidadLayout />}>
        <Route index element={<Navigate to="libro-diario" replace />} />
        <Route path="libro-diario" element={<LibroDiarioPage />} />
        <Route path="libro-mayor" element={<LibroMayorPage />} />
        <Route path="balanza" element={<BalanzaPage />} />
        <Route path="estados" element={<EstadosFinancierosPage />} />
        <Route path="ajuste" element={<AsientoAjustePage />} />
      </Route>
    </Routes>
  );
}
