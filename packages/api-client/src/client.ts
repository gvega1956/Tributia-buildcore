import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema.js';

export interface TributiaClientConfig {
  baseUrl: string;
  /** Devuelve el JWT access token vigente, o null si no hay sesión. */
  getAccessToken?: () => string | null | undefined;
  /** Llamado cuando la respuesta es 401 (token expirado). */
  onUnauthorized?: () => void;
}

/**
 * Crea un cliente HTTP tipado contra la API de Tributia BuildCore.
 * Los tipos de request/response derivan del spec OpenAPI generado.
 *
 * @example
 * const api = buildClient({ baseUrl: 'http://localhost:3000', getAccessToken: () => token });
 * const { data, error } = await api.POST('/api/v1/auth/login', {
 *   body: { tenantSlug: 'constructora-norte', email: 'admin@...', password: '...' }
 * });
 */
export function buildClient(config: TributiaClientConfig) {
  const client = createClient<paths>({ baseUrl: config.baseUrl });

  const authMiddleware: Middleware = {
    onRequest({ request }) {
      const token = config.getAccessToken?.();
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
    onResponse({ response }) {
      if (response.status === 401) {
        config.onUnauthorized?.();
      }
      return response;
    },
  };

  client.use(authMiddleware);
  return client;
}
