import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/layout/app-layout';
import { LoginPage } from './pages/login';
import { ProyectosPage } from './pages/proyectos';
import { TablEroPage } from './pages/tablero';
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
        <Route path="/proyectos" element={<ProyectosPage />} />
        <Route path="/proyectos/:id/tablero" element={<TablEroPage />} />
        {/* rutas stub — se implementan en sesiones posteriores */}
        <Route path="/compras/*" element={<ComingSoon label="Compras" />} />
        <Route path="/inventario/*" element={<ComingSoon label="Inventario" />} />
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
