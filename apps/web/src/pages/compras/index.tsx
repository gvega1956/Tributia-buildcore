import { NavLink, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { RequisicionesPage } from './requisiciones';
import { SolicitudesCotizacionPage } from './solicitudes-cotizacion';
import { OrdenesCompraPage } from './ordenes-compra';
import { FacturasProveedorPage } from './facturas-proveedor';
import { CuentasPorPagarPage } from './cuentas-por-pagar';

const NAV_ITEMS = [
  { to: 'requisiciones',           label: 'Requisiciones' },
  { to: 'solicitudes-cotizacion',  label: 'SOC' },
  { to: 'ordenes-compra',          label: 'Órdenes de compra' },
  { to: 'facturas-proveedor',      label: 'Facturas proveedor' },
  { to: 'cuentas-por-pagar',       label: 'Cuentas x pagar' },
];

function ComprasLayout() {
  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav */}
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

export function ComprasModule() {
  return (
    <Routes>
      <Route element={<ComprasLayout />}>
        <Route index element={<Navigate to="requisiciones" replace />} />
        <Route path="requisiciones" element={<RequisicionesPage />} />
        <Route path="solicitudes-cotizacion" element={<SolicitudesCotizacionPage />} />
        <Route path="ordenes-compra" element={<OrdenesCompraPage />} />
        <Route path="facturas-proveedor" element={<FacturasProveedorPage />} />
        <Route path="cuentas-por-pagar" element={<CuentasPorPagarPage />} />
      </Route>
    </Routes>
  );
}
