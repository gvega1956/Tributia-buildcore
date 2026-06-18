/**
 * Tipos generados automáticamente desde el spec OpenAPI.
 * Regenerar con: pnpm gen:api
 *
 * Este archivo es un placeholder mínimo. Una vez ejecutado `pnpm gen:api`
 * con el servidor corriendo, este archivo se reemplaza con el spec completo.
 */

export interface paths {
  '/api/v1/auth/login': {
    post: {
      requestBody: {
        content: {
          'application/json': {
            tenantSlug: string;
            email: string;
            password: string;
          };
        };
      };
      responses: {
        200: {
          content: {
            'application/json': {
              accessToken: string;
              refreshToken: string;
            };
          };
        };
        401: { content: never };
      };
    };
  };
  '/api/v1/auth/refresh': {
    post: {
      requestBody: {
        content: {
          'application/json': {
            refreshToken: string;
          };
        };
      };
      responses: {
        200: {
          content: {
            'application/json': {
              accessToken: string;
              refreshToken: string;
            };
          };
        };
        401: { content: never };
      };
    };
  };
}

export type webhooks = Record<string, never>;
export interface components { schemas: Record<string, never> }
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
