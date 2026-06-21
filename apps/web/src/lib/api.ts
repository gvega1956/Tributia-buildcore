import { buildClient } from '@tributia/api-client';

const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3000';

export function getApiClient() {
  return buildClient({
    baseUrl: API_URL,
    getAccessToken: () => localStorage.getItem('tributia_access_token'),
    onUnauthorized: () => {
      localStorage.removeItem('tributia_access_token');
      localStorage.removeItem('tributia_refresh_token');
      window.location.href = '/login';
    },
  });
}

export type ApiClient = ReturnType<typeof getApiClient>;
