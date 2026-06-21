import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/layout/app-layout';
import { LoginPage } from './pages/login';
import { ProyectosPage } from './pages/proyectos';
import { ProyectoDetallePage } from './pages/proyecto-detalle';
import { ProyectoFormPage } from './pages/proyecto-form';
import { TablEroPage } from './pages/tablero';
import { ComprasModule } from './pages/compras/index';
import { InventarioModule } from './pages/inventario/index';
import { LoadingScreen } from './components/ui/states';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { accessToken, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/proyectos" replace />} />

        {/* Proyectos */}
        <Route path="/proyectos" element={<ProyectosPage />} />
        <Route path="/proyectos/nuevo" element={<ProyectoFormPage mode="create" />} />
        <Route path="/proyectos/:id" element={<ProyectoDetallePage />} />
        <Route path="/proyectos/:id/editar" element={<ProyectoFormPage mode="edit" />} />
        <Route path="/proyectos/:id/tablero" element={<TablEroPage />} />

        {/* Compras — flujo completo requisición → OC → recepción → factura → CxP */}
        <Route path="/compras/*" element={<ComprasModule />} />

        {/* Inventario — almacenes, stock, movimientos, kardex */}
        <Route path="/inventario/*" element={<InventarioModule />} />

        {/* Rutas stub pendientes de sesiones futuras */}
        <Route path="/obra/*" element={<ComingSoon label="Obra" />} />
        <Route path="/cxc/*" element={<ComingSoon label="Cuentas x cobrar" />} />
        <Route path="/tesoreria/*" element={<ComingSoon label="Tesorería" />} />
        <Route path="/contabilidad/*" element={<ComingSoon label="Contabilidad" />} />
        <Route path="/configuracion/*" element={<ComingSoon label="Configuración" />} />
      </Route>

      <Route path="*" element={<Navigate to="/proyectos" replace />} />
    </Routes>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
      {label} — próximamente
    </div>
  );
}
