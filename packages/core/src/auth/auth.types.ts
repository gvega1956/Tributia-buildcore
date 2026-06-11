export interface JwtPayload {
  sub: string;
  tenantId: string;
  empresaId: string;
  email: string;
  iat?: number;
  exp?: number;
}
