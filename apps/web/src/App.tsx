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
import { ObraModule } from './pages/obra/index';
import { OrdenesCambioModule } from './pages/ordenes-cambio/index';
import { ContabilidadModule } from './pages/contabilidad/index';
import { CxcModule } from './pages/cxc/index';
import { TesoreriaModule } from './pages/tesoreria/index';
import { DashboardEjecutivoPage } from './pages/dashboard-ejecutivo';
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
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardEjecutivoPage />} />

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

        {/* Obra — parte diario, avance físico, RFI, punch list */}
        <Route path="/obra/*" element={<ObraModule />} />

        {/* Órdenes de Cambio — modificaciones al contrato */}
        <Route path="/ordenes-cambio/*" element={<OrdenesCambioModule />} />

        {/* Módulos Capa 2 */}
        <Route path="/contabilidad/*" element={<ContabilidadModule />} />
        <Route path="/cxc/*" element={<CxcModule />} />
        <Route path="/tesoreria/*" element={<TesoreriaModule />} />

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
