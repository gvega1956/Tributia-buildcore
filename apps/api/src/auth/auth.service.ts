import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { eq, and, gt } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { zLoginInput, zRefreshInput, type JwtPayload } from '@tributia/core';
import * as schema from '../db/schema/index.js';
import { newId } from '@tributia/shared';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshTokenTtlMs: number;

  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    const days = this.config.get<number>('REFRESH_TOKEN_DAYS', 7);
    this.refreshTokenTtlMs = days * 24 * 60 * 60 * 1000;
  }

  async login(body: unknown): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    usuario: { id: string; email: string; nombre: string; apellido: string; empresaId: string; tenantId: string };
  }> {
    const { tenantSlug, email, password } = zLoginInput.parse(body);

    // Resolve tenant by slug (admin connection — no tenant context yet)
    const [tenant] = await this.db.adminDb
      .select()
      .from(schema.tenants)
      .where(and(eq(schema.tenants.slug, tenantSlug), eq(schema.tenants.activo, true)));

    if (!tenant) {
      this.logger.warn(`Login fallido: tenant slug "${tenantSlug}" no encontrado`);
      // Respuesta genérica para no filtrar información de tenants
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Find user within tenant
    const [usuario] = await this.db.adminDb
      .select()
      .from(schema.usuarios)
      .where(
        and(
          eq(schema.usuarios.email, email),
          eq(schema.usuarios.tenantId, tenant.id),
          eq(schema.usuarios.activo, true),
        ),
      );

    if (!usuario) {
      this.logger.warn(`Login fallido: usuario "${email}" no encontrado en tenant ${tenantSlug}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verify password
    const valid = await argon2.verify(usuario.passwordHash, password);
    if (!valid) {
      this.logger.warn(`Login fallido: contraseña incorrecta para ${email} en ${tenantSlug}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Resolve empresa assignment (first active empresa for this user)
    const [asignacion] = await this.db.adminDb
      .select({ empresaId: schema.usuarioRolEmpresa.empresaId })
      .from(schema.usuarioRolEmpresa)
      .where(
        and(
          eq(schema.usuarioRolEmpresa.usuarioId, usuario.id),
          eq(schema.usuarioRolEmpresa.tenantId, tenant.id),
        ),
      )
      .limit(1);

    if (!asignacion) {
      throw new ForbiddenException('El usuario no tiene empresa asignada');
    }

    const payload: JwtPayload = {
      sub: usuario.id,
      tenantId: tenant.id,
      empresaId: asignacion.empresaId,
      email: usuario.email,
    };

    const accessToken = this.jwt.sign(payload);
    const expiresIn = this.config.get<number>('JWT_EXPIRES_IN_SECONDS', 900);

    const { refreshToken, tokenHash } = this.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlMs);

    await this.db.adminDb.insert(schema.refreshTokens).values({
      id: newId(),
      tenantId: tenant.id,
      usuarioId: usuario.id,
      tokenHash,
      expiresAt,
      createdBy: usuario.id,
      updatedBy: usuario.id,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        empresaId: asignacion.empresaId,
        tenantId: tenant.id,
      },
    };
  }

  async refresh(body: unknown): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const { refreshToken } = zRefreshInput.parse(body);

    const tokenHash = this.hashToken(refreshToken);
    const now = new Date();

    const [stored] = await this.db.adminDb
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.tokenHash, tokenHash),
          eq(schema.refreshTokens.revocado, false),
          gt(schema.refreshTokens.expiresAt, now),
        ),
      );

    if (!stored) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    // Revocar token usado (rotación single-use)
    await this.db.adminDb
      .update(schema.refreshTokens)
      .set({ revocado: true, updatedBy: stored.usuarioId })
      .where(eq(schema.refreshTokens.id, stored.id));

    const [usuario] = await this.db.adminDb
      .select()
      .from(schema.usuarios)
      .where(and(eq(schema.usuarios.id, stored.usuarioId), eq(schema.usuarios.activo, true)));

    if (!usuario) {
      throw new UnauthorizedException('Usuario inactivo');
    }

    const [asignacion] = await this.db.adminDb
      .select({ empresaId: schema.usuarioRolEmpresa.empresaId })
      .from(schema.usuarioRolEmpresa)
      .where(
        and(
          eq(schema.usuarioRolEmpresa.usuarioId, usuario.id),
          eq(schema.usuarioRolEmpresa.tenantId, stored.tenantId),
        ),
      )
      .limit(1);

    if (!asignacion) {
      throw new ForbiddenException('Sin empresa asignada');
    }

    const payload: JwtPayload = {
      sub: usuario.id,
      tenantId: stored.tenantId,
      empresaId: asignacion.empresaId,
      email: usuario.email,
    };

    const accessToken = this.jwt.sign(payload);
    const expiresIn = this.config.get<number>('JWT_EXPIRES_IN_SECONDS', 900);

    const { refreshToken: newToken, tokenHash: newHash } = this.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlMs);

    await this.db.adminDb.insert(schema.refreshTokens).values({
      id: newId(),
      tenantId: stored.tenantId,
      usuarioId: usuario.id,
      tokenHash: newHash,
      expiresAt,
      createdBy: usuario.id,
      updatedBy: usuario.id,
    });

    return { accessToken, refreshToken: newToken, expiresIn };
  }

  async logout(usuarioId: string, tenantId: string): Promise<void> {
    // Revoca todos los refresh tokens activos de este usuario en este tenant
    await this.db.adminDb
      .update(schema.refreshTokens)
      .set({ revocado: true, updatedBy: usuarioId })
      .where(
        and(
          eq(schema.refreshTokens.usuarioId, usuarioId),
          eq(schema.refreshTokens.tenantId, tenantId),
          eq(schema.refreshTokens.revocado, false),
        ),
      );
  }

  /** Genera un UUID v7 opaco como refresh token y su hash SHA-256. */
  private generateRefreshToken(): { refreshToken: string; tokenHash: string } {
    const refreshToken = newId();
    const tokenHash = this.hashToken(refreshToken);
    return { refreshToken, tokenHash };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Hashea una contraseña con argon2id (uso en seeds y cambio de contraseña). */
  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }
}
