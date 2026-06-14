/**
 * PRUEBAS DE PROYECTOS — Sesión 1 Capa 1
 *
 * Cubren:
 *   1.  Crear proyecto (estado inicial PROSPECTO)
 *   2.  Tercero sin rol cliente → 422
 *   3.  Código duplicado en misma empresa → 409
 *   4.  Usuario empresa-level (proyecto:read) ve todos los proyectos
 *   5.  Usuario solo-proyecto ve únicamente el suyo (GET /proyectos)
 *   6.  Usuario solo-proyecto 403 en GET /proyectos/:otro-id
 *   7.  Transición válida PROSPECTO → LICITACION
 *   8.  Transición inválida PROSPECTO → EN_EJECUCION → 422
 *   9.  Transición inválida desde CERRADO (estado final) → 422
 *  10.  Actualizar datos del proyecto
 *  11.  Soft-delete → 204; GET → 404
 *  12.  Asignar miembro al equipo del proyecto
 *  13.  RLS: usuario de otro tenant no ve proyectos de este tenant
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
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../app.module.js';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

const SLUG = `test-proy-${Date.now()}`;
const ADMIN_EMAIL = `proy-admin@${SLUG}.com`;
const ADMIN_PASS = 'AdminProy!99';
// Usuario con rol empresa pero SIN proyecto:read → accede solo vía usuario_rol_proyecto
const CAMPO_EMAIL = `proy-campo@${SLUG}.com`;
const CAMPO_PASS = 'CampoProy!88';

describe('Proyectos Capa 1', () => {
  let app: INestApplication;
  let adminPool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let jwt: JwtService;

  let tenantId: string;
  let empresaId: string;
  let adminUserId: string;
  let campoUserId: string;
  let rolAdminId: string;
  let rolCampoId: string;
  let clienteId: string;
  let proyectoAId: string;
  let proyectoBId: string;

  let adminToken: string;
  let campoToken: string;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    db = drizzle(adminPool, { schema });

    tenantId = newId();
    empresaId = newId();
    adminUserId = newId();
    campoUserId = newId();
    rolAdminId = newId();
    rolCampoId = newId();
    clienteId = newId();

    // ── Tenant ────────────────────────────────────────────────────────────────
    await db.insert(schema.tenants).values({
      id: tenantId,
      nombre: 'Constructora Proyectos Test',
      slug: SLUG,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // ── Empresa ───────────────────────────────────────────────────────────────
    await db.insert(schema.empresas).values({
      id: empresaId,
      tenantId,
      nombre: 'Empresa Test Proyectos',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // ── Usuarios ──────────────────────────────────────────────────────────────
    const adminHash = await argon2.hash(ADMIN_PASS, { type: argon2.argon2id });
    const campoHash = await argon2.hash(CAMPO_PASS, { type: argon2.argon2id });

    await db.insert(schema.usuarios).values([
      {
        id: adminUserId,
        tenantId,
        email: ADMIN_EMAIL,
        passwordHash: adminHash,
        nombre: 'Admin',
        apellido: 'Proyectos',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
      {
        id: campoUserId,
        tenantId,
        email: CAMPO_EMAIL,
        passwordHash: campoHash,
        nombre: 'Usuario',
        apellido: 'Campo',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    ]);

    // ── Roles ─────────────────────────────────────────────────────────────────
    await db.insert(schema.roles).values([
      {
        id: rolAdminId,
        tenantId,
        nombre: 'Admin Proyectos [test]',
        esSistema: true,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
      {
        id: rolCampoId,
        tenantId,
        // Rol con acceso empresa pero SIN proyecto:read — solo acceso vía proyecto
        nombre: 'Campo [test]',
        esSistema: true,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    ]);

    // ── Permisos ──────────────────────────────────────────────────────────────
    await db.insert(schema.rolPermisos).values([
      // Admin: puede leer y escribir proyectos y terceros
      { rolId: rolAdminId, permiso: 'proyecto:read',  tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
      { rolId: rolAdminId, permiso: 'proyecto:write', tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
      { rolId: rolAdminId, permiso: 'tercero:read',   tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
      { rolId: rolAdminId, permiso: 'tercero:write',  tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
      // Campo: acceso empresa pero SIN proyecto:read (solo accede por usuario_rol_proyecto)
      { rolId: rolCampoId, permiso: 'tercero:read',   tenantId, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID },
    ]);

    // ── Asignaciones rol × empresa ────────────────────────────────────────────
    await db.insert(schema.usuarioRolEmpresa).values([
      {
        id: newId(),
        tenantId,
        usuarioId: adminUserId,
        empresaId,
        rolId: rolAdminId,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
      {
        id: newId(),
        tenantId,
        usuarioId: campoUserId,
        empresaId,
        rolId: rolCampoId, // sin proyecto:read
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      },
    ]);

    // ── Tercero cliente ───────────────────────────────────────────────────────
    await db.insert(schema.terceros).values({
      id: clienteId,
      tenantId,
      tipoIdentificacion: 'RNC',
      rncCedula: '101234567',
      nombreComercial: 'Cliente Demo Test',
      tipoContribuyente: 'PERSONA_JURIDICA',
      esCliente: true,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // ── App NestJS ────────────────────────────────────────────────────────────
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    jwt = module.get(JwtService);

    // Tokens firmados directamente (sin pasar por login para agilizar setup)
    adminToken = jwt.sign({
      sub: adminUserId,
      tenantId,
      empresaId,
      email: ADMIN_EMAIL,
    });
    campoToken = jwt.sign({
      sub: campoUserId,
      tenantId,
      empresaId,
      email: CAMPO_EMAIL,
    });
  });

  afterAll(async () => {
    // Limpieza en orden de dependencias FK + DISABLE TRIGGER en tablas protegidas
    await adminPool.query(`DELETE FROM usuario_rol_proyecto WHERE tenant_id = $1`, [tenantId]);

    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);

    // tercero no tiene prevent_delete (solo soft-delete columns)
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM rol_permiso WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM usuario_rol_empresa WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM refresh_token WHERE tenant_id = $1`, [tenantId]);

    await adminPool.query(`ALTER TABLE rol DISABLE TRIGGER no_delete_rol`);
    await adminPool.query(`DELETE FROM rol WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE rol ENABLE TRIGGER no_delete_rol`);

    await adminPool.query(`ALTER TABLE usuario DISABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`DELETE FROM usuario WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE usuario ENABLE TRIGGER no_delete_usuario`);

    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);

    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);

    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);

    await app.close();
    await adminPool.end();
  });

  // ── 1. Crear proyecto ─────────────────────────────────────────────────────

  it('1. POST /proyectos → 201, estado PROSPECTO', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/proyectos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codigo: 'PRY-A',
        nombre: 'Proyecto Alpha [test]',
        tipoObra: 'RESIDENCIAL',
        clienteId,
        monedaContrato: 'DOP',
      })
      .expect(201);

    proyectoAId = (res.body as { id: string }).id;
    expect(res.body).toMatchObject({
      estado: 'PROSPECTO',
      codigo: 'PRY-A',
      tenantId,
      empresaId,
      clienteId,
    });
  });

  it('2. POST /proyectos → 201, crea proyecto B', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/proyectos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        codigo: 'PRY-B',
        nombre: 'Proyecto Beta [test]',
        tipoObra: 'COMERCIAL',
        clienteId,
        monedaContrato: 'USD',
      })
      .expect(201);

    proyectoBId = (res.body as { id: string }).id;
    expect(res.body).toMatchObject({ estado: 'PROSPECTO', codigo: 'PRY-B' });
  });

  it('3. Tercero sin rol cliente → 422', async () => {
    // Crear tercero que no es cliente
    const noClienteId = newId();
    await db.insert(schema.terceros).values({
      id: noClienteId,
      tenantId,
      tipoIdentificacion: 'RNC',
      rncCedula: '109999999',
      nombreComercial: 'Proveedor Solo',
      tipoContribuyente: 'PERSONA_JURIDICA',
      esProveedor: true,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await request(app.getHttpServer())
      .post('/api/v1/proyectos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ codigo: 'PRY-ERR', nombre: 'Mal', tipoObra: 'OTRO', clienteId: noClienteId })
      .expect(422);

    // Limpiar
    await adminPool.query(`DELETE FROM tercero WHERE id = $1`, [noClienteId]);
  });

  it('4. Código duplicado en misma empresa → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/proyectos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ codigo: 'PRY-A', nombre: 'Duplicado', tipoObra: 'OTRO', clienteId })
      .expect(409);
  });

  // ── 5-6. Permiso por proyecto ─────────────────────────────────────────────

  it('5. Admin (empresa:read) ve todos los proyectos de la empresa', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/proyectos')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const ids = (res.body as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(proyectoAId);
    expect(ids).toContain(proyectoBId);
  });

  it('6. Usuario campo sin proyecto:read ve lista vacía (sin asignación aún)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/proyectos')
      .set('Authorization', `Bearer ${campoToken}`)
      .expect(200);

    expect(res.body).toHaveLength(0);
  });

  it('7. Asignar usuario campo a proyecto A', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoAId}/equipo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ usuarioId: campoUserId, rolId: rolCampoId })
      .expect(201);

    expect(res.body).toMatchObject({ usuarioId: campoUserId, proyectoId: proyectoAId });
  });

  it('8. Usuario campo (solo proyecto A) ve solo proyecto A en listado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/proyectos')
      .set('Authorization', `Bearer ${campoToken}`)
      .expect(200);

    const ids = (res.body as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(proyectoAId);
    expect(ids).not.toContain(proyectoBId);
  });

  it('9. Usuario campo → GET /proyectos/:idB → 403', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoBId}`)
      .set('Authorization', `Bearer ${campoToken}`)
      .expect(403);
  });

  it('10. Usuario campo → GET /proyectos/:idA → 200 (tiene acceso)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoAId}`)
      .set('Authorization', `Bearer ${campoToken}`)
      .expect(200);

    expect((res.body as { id: string }).id).toBe(proyectoAId);
  });

  // ── 11-13. Ciclo de estados ───────────────────────────────────────────────

  it('11. Transición válida: PROSPECTO → LICITACION', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/proyectos/${proyectoAId}/estado`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'LICITACION' })
      .expect(200);

    expect((res.body as { estado: string }).estado).toBe('LICITACION');
  });

  it('12. Transición inválida: LICITACION → EN_EJECUCION (saltea estados) → 422', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/proyectos/${proyectoAId}/estado`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'EN_EJECUCION' })
      .expect(422);
  });

  it('13. Transición inválida: PROSPECTO → CERRADO (último estado directo) → 422', async () => {
    // proyectoB sigue en PROSPECTO
    await request(app.getHttpServer())
      .patch(`/api/v1/proyectos/${proyectoBId}/estado`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'CERRADO' })
      .expect(422);
  });

  // ── 14. Actualizar ────────────────────────────────────────────────────────

  it('14. PUT /proyectos/:id → 200, actualiza nombre', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/proyectos/${proyectoBId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Proyecto Beta Actualizado [test]' })
      .expect(200);

    expect((res.body as { nombre: string }).nombre).toBe('Proyecto Beta Actualizado [test]');
  });

  // ── 15. Soft-delete ───────────────────────────────────────────────────────

  it('15. DELETE /proyectos/:id → 204; GET → 404', async () => {
    // Crear proyecto temporal para borrar
    const tmpRes = await request(app.getHttpServer())
      .post('/api/v1/proyectos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ codigo: 'PRY-TMP', nombre: 'Temporal', tipoObra: 'OTRO', clienteId })
      .expect(201);

    const tmpId = (tmpRes.body as { id: string }).id;

    await request(app.getHttpServer())
      .delete(`/api/v1/proyectos/${tmpId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${tmpId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  // ── 16. RLS ───────────────────────────────────────────────────────────────

  it('16. Usuario de otro tenant NO ve proyectos de este tenant (RLS)', async () => {
    // Crear otro tenant con su usuario
    const tenant2Id = newId();
    const empresa2Id = newId();
    const user2Id = newId();
    const rol2Id = newId();
    const slug2 = `test-proy2-${Date.now()}`;

    await db.insert(schema.tenants).values({
      id: tenant2Id,
      nombre: 'Tenant 2 Proyectos Test',
      slug: slug2,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.empresas).values({
      id: empresa2Id,
      tenantId: tenant2Id,
      nombre: 'Empresa Tenant 2',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.usuarios).values({
      id: user2Id,
      tenantId: tenant2Id,
      email: `admin@${slug2}.com`,
      passwordHash: 'x',
      nombre: 'Admin2',
      apellido: 'T2',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.roles).values({
      id: rol2Id,
      tenantId: tenant2Id,
      nombre: 'Admin [t2]',
      esSistema: true,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.rolPermisos).values({
      rolId: rol2Id,
      permiso: 'proyecto:read',
      tenantId: tenant2Id,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.usuarioRolEmpresa).values({
      id: newId(),
      tenantId: tenant2Id,
      usuarioId: user2Id,
      empresaId: empresa2Id,
      rolId: rol2Id,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // Token del usuario del tenant 2
    const token2 = jwt.sign({
      sub: user2Id,
      tenantId: tenant2Id,
      empresaId: empresa2Id,
      email: `admin@${slug2}.com`,
    });

    // Tenant 2 no tiene proyectos → lista vacía (RLS lo aisla)
    const res = await request(app.getHttpServer())
      .get('/api/v1/proyectos')
      .set('Authorization', `Bearer ${token2}`)
      .expect(200);

    expect(res.body).toHaveLength(0);

    // Cleanup tenant 2 — mismo patrón DISABLE TRIGGER
    await adminPool.query(`DELETE FROM rol_permiso WHERE tenant_id = $1`, [tenant2Id]);
    await adminPool.query(`DELETE FROM usuario_rol_empresa WHERE tenant_id = $1`, [tenant2Id]);

    await adminPool.query(`ALTER TABLE rol DISABLE TRIGGER no_delete_rol`);
    await adminPool.query(`DELETE FROM rol WHERE tenant_id = $1`, [tenant2Id]);
    await adminPool.query(`ALTER TABLE rol ENABLE TRIGGER no_delete_rol`);

    await adminPool.query(`ALTER TABLE usuario DISABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`DELETE FROM usuario WHERE tenant_id = $1`, [tenant2Id]);
    await adminPool.query(`ALTER TABLE usuario ENABLE TRIGGER no_delete_usuario`);

    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id = $1`, [tenant2Id]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);

    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenant2Id]);

    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id = $1`, [tenant2Id]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
  });
});
