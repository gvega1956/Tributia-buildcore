/**
 * PRUEBAS DE AUTORIZACIÓN — Sesión 3 Capa 0 (ampliado en pre-vuelo Capa 1)
 *
 * Cubren las propiedades fundamentales del sistema IAM:
 *   1.  Login correcto devuelve tokens
 *   2.  Login incorrecto devuelve 401
 *   3.  Login con tenant inexistente → 401 (sin filtración de información)
 *   4.  Endpoint @Public (/health) funciona sin token
 *   5.  Endpoint protegido sin token → 401
 *   6.  Logout con token válido (RequireAuth) → 204
 *   7.  Token con permiso suficiente (usuario:read) → guard pasa [DB query]
 *   8.  Usuario con rol SoloLectura NO tiene permiso usuario:write [DB query]
 *   9.  Refresh token válido emite nuevo access_token y nuevo refresh_token
 *  10.  Refresh token usado dos veces → segundo uso rechazado (rotación)
 *  11.  Logout invalida todos los refresh tokens
 *  12.  Token expirado → 401
 *  13.  HTTP 403 REAL: usuario sin tercero:read llama GET /api/v1/terceros → 403
 *  14.  HTTP 403 empresa: mismo usuario, JWT con empresa sin rol → 403
 *  15.  HTTP 200 empresa: mismo usuario, JWT con empresa correcta → 200
 *
 * Pre-vuelo Capa 1 — tests 13-15 demuestran:
 *   - La ForbiddenException se lanza en la capa HTTP (no solo en DB queries)
 *   - El guard diferencia permisos POR EMPRESA (mismo usuario, misma BD, distinta empresa)
 *   - Proyecciones a futuro: cuando se construya packages/proyectos se documentará
 *     la diferenciación por proyecto en ADR (los roles de proyecto no existen aún).
 *
 * Correr con: pnpm --filter @tributia/api test:integration
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../app.module.js';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';

// ─── Conexiones de prueba ─────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const SLUG = `test-auth-${Date.now()}`;
const EMAIL = `auth-test@${SLUG}.com`;
const PASSWORD = 'TestPass!99';
const WRONG_PASSWORD = 'WrongPass!99';

// Usuario de solo lectura (para test HTTP 403 real)
const READONLY_EMAIL = `readonly-${SLUG}@test.com`;
const READONLY_PASSWORD = 'ReadOnly!88';

describe('Autorización IAM', () => {
  let app: INestApplication;
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;
  let jwtService: JwtService;

  let tenantId: string;
  let empresaId: string;
  let empresa2Id: string;
  let usuarioId: string;
  let readonlyUserId: string;
  let rolAdminId: string;
  let rolSoloLecturaId: string;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb = drizzle(adminPool, { schema });

    // ── IDs ────────────────────────────────────────────────────────────────────
    tenantId = newId();
    empresaId = newId();
    empresa2Id = newId();
    usuarioId = newId();
    readonlyUserId = newId();
    rolAdminId = newId();
    rolSoloLecturaId = newId();

    // ── Tenant ────────────────────────────────────────────────────────────────
    await adminDb.insert(schema.tenants).values({
      id: tenantId,
      nombre: 'Constructora Test Auth',
      slug: SLUG,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // ── Empresas ──────────────────────────────────────────────────────────────
    await adminDb.insert(schema.empresas).values([
      {
        id: empresaId,
        tenantId,
        nombre: 'Empresa Principal [test]',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
      {
        id: empresa2Id,
        tenantId,
        nombre: 'Empresa Secundaria [test]',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    ]);

    // ── Usuarios ──────────────────────────────────────────────────────────────
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await adminDb.insert(schema.usuarios).values({
      id: usuarioId,
      tenantId,
      email: EMAIL,
      passwordHash,
      nombre: 'Test',
      apellido: 'Auth',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    const readonlyHash = await argon2.hash(READONLY_PASSWORD, { type: argon2.argon2id });
    await adminDb.insert(schema.usuarios).values({
      id: readonlyUserId,
      tenantId,
      email: READONLY_EMAIL,
      passwordHash: readonlyHash,
      nombre: 'Solo',
      apellido: 'Lectura',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // ── Roles ─────────────────────────────────────────────────────────────────
    await adminDb.insert(schema.roles).values([
      {
        id: rolAdminId,
        tenantId,
        nombre: 'Administrador [test]',
        esSistema: true,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
      {
        id: rolSoloLecturaId,
        tenantId,
        nombre: 'Solo Lectura [test]',
        esSistema: true,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    ]);

    // ── Permisos ──────────────────────────────────────────────────────────────
    await adminDb.insert(schema.rolPermisos).values([
      // rolAdmin: permisos de usuario + proyecto + tercero (para tests HTTP)
      { rolId: rolAdminId, permiso: 'usuario:read',  tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
      { rolId: rolAdminId, permiso: 'usuario:write', tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
      { rolId: rolAdminId, permiso: 'proyecto:read', tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
      { rolId: rolAdminId, permiso: 'tercero:read',  tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
      // rolSoloLectura: solo proyecto:read — sin tercero:read (para test 403 real)
      { rolId: rolSoloLecturaId, permiso: 'proyecto:read', tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
    ]);

    // ── Asignaciones rol×empresa ──────────────────────────────────────────────
    // usuarioId → rolAdmin EN empresa1 SOLAMENTE (empresa2 sin rol → 403)
    await adminDb.insert(schema.usuarioRolEmpresa).values({
      id: newId(),
      tenantId,
      usuarioId,
      empresaId,
      rolId: rolAdminId,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // readonlyUserId → rolSoloLectura en empresa1 (sin tercero:read → 403)
    await adminDb.insert(schema.usuarioRolEmpresa).values({
      id: newId(),
      tenantId,
      usuarioId: readonlyUserId,
      empresaId,
      rolId: rolSoloLecturaId,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // ── Aplicación NestJS ─────────────────────────────────────────────────────
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Sin setGlobalPrefix: todos los controllers ya incluyen 'api/v1' en su ruta.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    jwtService = moduleFixture.get(JwtService);
  });

  afterAll(async () => {
    if (adminPool) {
      // Limpiar sin trigger restrictions (DISABLE TRIGGER requiere superuser)
      await adminPool.query(`DELETE FROM refresh_token WHERE tenant_id = $1`, [tenantId]);
      await adminPool.query(`DELETE FROM usuario_rol_empresa WHERE tenant_id = $1`, [tenantId]);
      await adminPool.query(
        `DELETE FROM rol_permiso WHERE rol_id = ANY($1::uuid[])`,
        [[rolAdminId, rolSoloLecturaId]],
      );

      // Roles: prevent_delete activo → deshabilitar trigger
      await adminPool.query(`ALTER TABLE rol DISABLE TRIGGER no_delete_rol`);
      await adminPool.query(
        `DELETE FROM rol WHERE id = ANY($1::uuid[])`,
        [[rolAdminId, rolSoloLecturaId]],
      );
      await adminPool.query(`ALTER TABLE rol ENABLE TRIGGER no_delete_rol`);

      // Usuarios
      await adminPool.query(`ALTER TABLE usuario DISABLE TRIGGER no_delete_usuario`);
      await adminPool.query(`DELETE FROM usuario WHERE tenant_id = $1`, [tenantId]);
      await adminPool.query(`ALTER TABLE usuario ENABLE TRIGGER no_delete_usuario`);

      // Empresas
      await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
      await adminPool.query(`DELETE FROM empresa WHERE tenant_id = $1`, [tenantId]);
      await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);

      // audit_log referencia tenant → borrar antes (tributia superuser puede hacerlo)
      await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);

      // Tenant
      await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
      await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
      await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    }
    await app?.close();
    await adminPool?.end();
  });

  // ─── 1. Login correcto ────────────────────────────────────────────────────
  it('1. login correcto devuelve access_token y refresh_token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: SLUG, email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body).toHaveProperty('expiresIn');
    expect(res.body.usuario.email).toBe(EMAIL);
  });

  // ─── 2. Login incorrecto ──────────────────────────────────────────────────
  it('2. login con contraseña incorrecta → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: SLUG, email: EMAIL, password: WRONG_PASSWORD });

    expect(res.status).toBe(401);
  });

  // ─── 3. Tenant inexistente ────────────────────────────────────────────────
  it('3. login con tenant inexistente → 401 (misma respuesta, sin filtración)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: 'no-existe-9999', email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Credenciales inválidas');
  });

  // ─── 4. Endpoint público ──────────────────────────────────────────────────
  it('4. endpoint @Public (/health) funciona sin Authorization header', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  // ─── 5. Sin token → 401 ───────────────────────────────────────────────────
  it('5. endpoint protegido sin token → 401', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });

  // ─── 6. Logout con token válido ───────────────────────────────────────────
  it('6. logout con token válido (RequireAuth) → 204', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: SLUG, email: EMAIL, password: PASSWORD });

    expect(loginRes.status).toBe(200);
    const { accessToken } = loginRes.body as { accessToken: string };

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(204);
  });

  // ─── 7. Permiso suficiente [DB] ───────────────────────────────────────────
  it('7. token con permiso suficiente (usuario:read) → guard pasa [DB query]', async () => {
    const rows = await adminDb
      .select({ permiso: schema.rolPermisos.permiso })
      .from(schema.rolPermisos)
      .innerJoin(
        schema.usuarioRolEmpresa,
        and(
          eq(schema.rolPermisos.rolId, schema.usuarioRolEmpresa.rolId),
          eq(schema.usuarioRolEmpresa.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(schema.usuarioRolEmpresa.usuarioId, usuarioId),
          eq(schema.usuarioRolEmpresa.empresaId, empresaId),
          eq(schema.usuarioRolEmpresa.tenantId, tenantId),
          eq(schema.rolPermisos.permiso, 'usuario:read'),
        ),
      )
      .limit(1);

    expect(rows.length).toBe(1);
  });

  // ─── 8. Sin permiso [DB] ──────────────────────────────────────────────────
  it('8. usuario con rol SoloLectura NO tiene permiso usuario:write [DB query]', async () => {
    const rows = await adminDb
      .select({ permiso: schema.rolPermisos.permiso })
      .from(schema.rolPermisos)
      .innerJoin(
        schema.usuarioRolEmpresa,
        and(
          eq(schema.rolPermisos.rolId, schema.usuarioRolEmpresa.rolId),
          eq(schema.usuarioRolEmpresa.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(schema.usuarioRolEmpresa.usuarioId, readonlyUserId),
          eq(schema.usuarioRolEmpresa.empresaId, empresaId),
          eq(schema.usuarioRolEmpresa.tenantId, tenantId),
          eq(schema.rolPermisos.permiso, 'usuario:write'),
        ),
      )
      .limit(1);

    expect(rows.length).toBe(0);
  });

  // ─── 9. Refresh token rotación ────────────────────────────────────────────
  it('9. refresh token válido emite nuevo access_token y nuevo refresh_token', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: SLUG, email: EMAIL, password: PASSWORD });

    const { refreshToken } = loginRes.body as { refreshToken: string };

    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body).toHaveProperty('accessToken');
    expect(refreshRes.body).toHaveProperty('refreshToken');
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken);
  });

  // ─── 10. Refresh token reutilizado ────────────────────────────────────────
  it('10. refresh token usado dos veces → segundo uso rechazado', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: SLUG, email: EMAIL, password: PASSWORD });

    const { refreshToken } = loginRes.body as { refreshToken: string };

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    const res2 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(res2.status).toBe(401);
  });

  // ─── 11. Logout invalida refresh tokens ──────────────────────────────────
  it('11. logout invalida todos los refresh tokens del usuario', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: SLUG, email: EMAIL, password: PASSWORD });

    const { accessToken, refreshToken } = loginRes.body as {
      accessToken: string;
      refreshToken: string;
    };

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshRes.status).toBe(401);
  });

  // ─── 12. Token expirado ───────────────────────────────────────────────────
  it('12. access token expirado → 401', async () => {
    const expiredToken = jwtService.sign(
      { sub: usuarioId, tenantId, empresaId, email: EMAIL },
      { expiresIn: -1 },
    );

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  // ─── 13. HTTP 403 REAL — usuario sin tercero:read ─────────────────────────
  it('13. usuario con solo proyecto:read llama GET /api/v1/terceros → HTTP 403 real', async () => {
    // Login como readonlyUser (rolSoloLectura: solo proyecto:read, sin tercero:read)
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: SLUG, email: READONLY_EMAIL, password: READONLY_PASSWORD });

    expect(loginRes.status).toBe(200);
    const { accessToken } = loginRes.body as { accessToken: string };

    // GET /api/v1/terceros requiere tercero:read → debe rechazar con 403
    const res = await request(app.getHttpServer())
      .get('/api/v1/terceros')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Sin permiso: tercero:read/);
  });

  // ─── 14. HTTP 403 empresa — mismo usuario, empresa sin rol ────────────────
  it('14. JWT con empresaId donde el usuario no tiene rol → HTTP 403 (diferenciación por empresa)', async () => {
    // El usuarioId tiene rolAdmin en empresa1 pero NO en empresa2.
    // Forjamos un token con empresa2Id — el guard debe rechazarlo.
    const tokenEmpresa2 = jwtService.sign({
      sub: usuarioId,
      tenantId,
      empresaId: empresa2Id,
      email: EMAIL,
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/terceros')
      .set('Authorization', `Bearer ${tokenEmpresa2}`);

    expect(res.status).toBe(403);
  });

  // ─── 15. HTTP 200 empresa — mismo usuario, empresa con rol correcto ───────
  it('15. JWT con empresaId donde el usuario tiene tercero:read → HTTP 200 (diferenciación por empresa)', async () => {
    // El usuarioId tiene rolAdmin (con tercero:read) en empresa1.
    const tokenEmpresa1 = jwtService.sign({
      sub: usuarioId,
      tenantId,
      empresaId,
      email: EMAIL,
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/terceros')
      .set('Authorization', `Bearer ${tokenEmpresa1}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
