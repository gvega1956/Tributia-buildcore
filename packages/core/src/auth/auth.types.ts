export interface JwtPayload {
  /** userId */
  sub: string;
  tenantId: string;
  empresaId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest {
  user: JwtPayload;
  tenantId?: string;
}
