import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiClient } from './api';

interface AuthState {
  accessToken: string | null;
  tenantSlug: string | null;
  email: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (tenantSlug: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    accessToken: null,
    tenantSlug: null,
    email: null,
    isLoading: true,
  });

  useEffect(() => {
    const token  = localStorage.getItem('tributia_access_token');
    const tenant = localStorage.getItem('tributia_tenant_slug');
    const email  = localStorage.getItem('tributia_email');
    setState({ accessToken: token, tenantSlug: tenant, email, isLoading: false });
  }, []);

  const login = useCallback(
    async (tenantSlug: string, email: string, password: string) => {
      const api = getApiClient();
      const { data, error } = await api.POST('/api/v1/auth/login', {
        body: { tenantSlug, email, password },
      });
      if (error || !data) {
        throw new Error((error as { message?: string } | undefined)?.message ?? 'Credenciales inválidas');
      }
      localStorage.setItem('tributia_access_token', data.accessToken);
      localStorage.setItem('tributia_refresh_token', data.refreshToken);
      localStorage.setItem('tributia_tenant_slug', tenantSlug);
      localStorage.setItem('tributia_email', email);
      setState({ accessToken: data.accessToken, tenantSlug, email, isLoading: false });
    },
    [],
  );

  const logout = useCallback(() => {
    localStorage.removeItem('tributia_access_token');
    localStorage.removeItem('tributia_refresh_token');
    localStorage.removeItem('tributia_tenant_slug');
    localStorage.removeItem('tributia_email');
    setState({ accessToken: null, tenantSlug: null, email: null, isLoading: false });
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

/** Hook auxiliar: redirige a /login si no hay sesión, útil en páginas que necesitan navigate. */
export function useRequireAuth() {
  const auth = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!auth.isLoading && !auth.accessToken) {
      navigate('/login', { replace: true });
    }
  }, [auth.isLoading, auth.accessToken, navigate]);
  return auth;
}
