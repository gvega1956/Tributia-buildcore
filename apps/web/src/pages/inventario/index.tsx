import { NavLink, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AlmacenesPage } from './almacenes';
import { StockPage } from './stock';
import { MovimientosPage } from './movimientos';
import { KardexPage } from './kardex';

const NAV_ITEMS = [
  { to: 'almacenes',   label: 'Almacenes' },
  { to: 'stock',       label: 'Stock' },
  { to: 'movimientos', label: 'Movimientos' },
  { to: 'kardex',      label: 'Kardex' },
];

function InventarioLayout() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 bg-white px-6">
        <nav className="flex gap-1 -mb-px">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  isActive
                    ? 'border-brand-500 text-brand-600'
                    : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300',
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

export function InventarioModule() {
  return (
    <Routes>
      <Route element={<InventarioLayout />}>
        <Route index element={<Navigate to="almacenes" replace />} />
        <Route path="almacenes"   element={<AlmacenesPage />} />
        <Route path="stock"       element={<StockPage />} />
        <Route path="movimientos" element={<MovimientosPage />} />
        <Route path="kardex"      element={<KardexPage />} />
      </Route>
    </Routes>
  );
}
