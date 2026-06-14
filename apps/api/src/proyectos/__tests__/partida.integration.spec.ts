/**
 * PRUEBAS DE INTEGRACIÓN — EDT / Partidas (Sesión 2 Capa 1)
 *
 * Cubren (disciplina: verificar el VALOR, no solo la ausencia de error):
 *  01. Crear capítulo → nivel=1, orden=1, numeroJerarquico="1"
 *  02. Crear segundo capítulo → nivel=1, orden=2, numeroJerarquico="2"
 *  03. Crear partida bajo capítulo 1 → nivel=2, orden=1, numeroJerarquico="1.1"
 *  04. Crear segunda partida bajo capítulo 1 → nivel=2, orden=2, numeroJerarquico="1.2"
 *  05. Crear sub-partida → nivel=3, orden=1, numeroJerarquico="1.1.1"
 *  06. Código duplicado en mismo proyecto → 409
 *  07. Nivel 4 (sub-sub-partida) → 422
 *  08. Reordenar: "1.1" → posición 2 → ahora es "1.2"; ex "1.2" ahora es "1.1"
 *  09. Sub-árbol actualizado tras reorden: sub-partida "1.1.1" pasa a "1.2.1"
 *  10. Borrar capítulo con hijos activos → 422
 *  11. Borrar partida con movimientos en el Ledger → 409
 *  12. Código igual en proyecto diferente → 201 (unicidad es por proyecto)
 *  13. Aislamiento RLS: token de tenant1 no puede ver EDT de tenant2
 *  14. GET árbol — orden jerárquico correcto y count coherente
 *  15. Soft-delete de partida sin hijos ni movimientos → 204; desaparece del árbol
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

const SLUG = `test-edt-${Date.now()}`;
const USER_EMAIL = `edt-admin@${SLUG}.com`;
const USER_PASS = 'EdtAdmin!77';

describe('EDT / Partidas — Sesión 2 Capa 1', () => {
  let app: INestApplication;
  let adminPool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let jwt: JwtService;

  // IDs del tenant de prueba
  let tenantId: string;
  let empresaId: string;
  let usuarioId: string;
  let rolId: string;
  let clienteId: string;
  let proyectoId: string;

  // IDs de partidas creadas durante los tests (para referencia cruzada)
  let cap1Id: string;   // capítulo 1
  let part1Id: string;  // partida 1.1 (bajo cap1)
  let part2Id: string;  // partida 1.2 (bajo cap1)
  let subId: string;    // sub-partida 1.1.1 (bajo part1)

  let token: string;

  // ── Segundo tenant para test de RLS ──────────────────────────────────────
  let tenant2Id: string;
  let empresa2Id: string;
  let usuario2Id: string;
  let rol2Id: string;
  let cliente2Id: string;
  let proyecto2Id: string;
  let token2: string;
  const USER2_EMAIL = `edt-t2@${SLUG}.com`;
  const USER2_PASS = 'EdtTenant2!66';

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    db = drizzle(adminPool, { schema });

    // ── Tenant 1 ────────────────────────────────────────────────────────────
    tenantId = newId();
    empresaId = newId();
    usuarioId = newId();
    rolId = newId();
    clienteId = newId();
    proyectoId = newId();

    await db.insert(schema.tenants).values({
      id: tenantId,
      nombre: 'Constructora EDT Test',
      slug: SLUG,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await db.insert(schema.empresas).values({
      id: empresaId,
      tenantId,
      nombre: 'Empresa EDT Test',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    const hash = await argon2.hash(USER_PASS, { type: argon2.argon2id });
    await db.insert(schema.usuarios).values({
      id: usuarioId,
      tenantId,
      email: USER_EMAIL,
      passwordHash: hash,
      nombre: 'Admin',
      apellido: 'EDT',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await db.insert(schema.roles).values({
      id: rolId,
      tenantId,
      nombre: 'Admin EDT',
      descripcion: 'Acceso total al módulo de EDT',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // Permisos necesarios para todos los endpoints de prueba
    const permisos = [
      'proyecto:read', 'proyecto:write',
      'edt:read', 'edt:write',
    ];
    await db.insert(schema.rolPermisos).values(
      permisos.map((p) => ({
        id: newId(),
        tenantId,
        rolId,
        permiso: p,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })),
    );

    await db.insert(schema.usuarioRolEmpresa).values({
      id: newId(),
      tenantId,
      usuarioId,
      empresaId,
      rolId,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // Tercero (cliente del proyecto)
    await db.insert(schema.terceros).values({
      id: clienteId,
      tenantId,
      tipoIdentificacion: 'RNC',
      rncCedula: '131-00001-1',
      nombreComercial: 'Cliente EDT Test',
      tipoContribuyente: 'PERSONA_JURIDICA',
      esCliente: true,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    // Proyecto base para los tests
    await db.insert(schema.proyectos).values({
      id: proyectoId,
      tenantId,
      empresaId,
      codigo: 'P-EDT-01',
      nombre: 'Proyecto EDT Test',
      tipoObra: 'RESIDENCIAL',
      clienteId,
      estado: 'EN_EJECUCION',
      createdBy: usuarioId,
      updatedBy: usuarioId,
    });

    // ── Tenant 2 (para test RLS) ─────────────────────────────────────────────
    const SLUG2 = `${SLUG}-t2`;
    tenant2Id = newId();
    empresa2Id = newId();
    usuario2Id = newId();
    rol2Id = newId();
    cliente2Id = newId();
    proyecto2Id = newId();

    await db.insert(schema.tenants).values({
      id: tenant2Id,
      nombre: 'Tenant 2 RLS EDT',
      slug: SLUG2,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.empresas).values({
      id: empresa2Id,
      tenantId: tenant2Id,
      nombre: 'Empresa 2 RLS',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    const hash2 = await argon2.hash(USER2_PASS, { type: argon2.argon2id });
    await db.insert(schema.usuarios).values({
      id: usuario2Id,
      tenantId: tenant2Id,
      email: USER2_EMAIL,
      passwordHash: hash2,
      nombre: 'User',
      apellido: 'Tenant2',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.roles).values({
      id: rol2Id,
      tenantId: tenant2Id,
      nombre: 'Admin T2',
      descripcion: '',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.rolPermisos).values(
      ['proyecto:read', 'edt:read', 'edt:write'].map((p) => ({
        id: newId(),
        tenantId: tenant2Id,
        rolId: rol2Id,
        permiso: p,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })),
    );
    await db.insert(schema.usuarioRolEmpresa).values({
      id: newId(),
      tenantId: tenant2Id,
      usuarioId: usuario2Id,
      empresaId: empresa2Id,
      rolId: rol2Id,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.terceros).values({
      id: cliente2Id,
      tenantId: tenant2Id,
      tipoIdentificacion: 'RNC',
      rncCedula: '131-00002-2',
      nombreComercial: 'Cliente T2',
      tipoContribuyente: 'PERSONA_JURIDICA',
      esCliente: true,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.proyectos).values({
      id: proyecto2Id,
      tenantId: tenant2Id,
      empresaId: empresa2Id,
      codigo: 'P-EDT-T2',
      nombre: 'Proyecto T2',
      tipoObra: 'COMERCIAL',
      clienteId: cliente2Id,
      estado: 'EN_EJECUCION',
      createdBy: usuario2Id,
      updatedBy: usuario2Id,
    });

    // ── NestJS app ───────────────────────────────────────────────────────────
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    jwt = app.get(JwtService);

    token = jwt.sign({
      sub: usuarioId,
      email: USER_EMAIL,
      tenantId,
      empresaId,
      roles: [rolId],
    });
    token2 = jwt.sign({
      sub: usuario2Id,
      email: USER2_EMAIL,
      tenantId: tenant2Id,
      empresaId: empresa2Id,
      roles: [rol2Id],
    });
  });

  afterAll(async () => {
    await app?.close();

    // ── Limpieza (ADR-0003: sin DELETE físico en tablas con prevent_delete;
    //   para partida y proyecto se deshabilita el trigger temporalmente) ──────

    // Limpiar eventos de test (append-only — deshabilitar trigger)
    await adminPool.query(
      `ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`,
    );
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(
      `ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`,
    );

    // Limpiar partidas (tenant 1 y tenant 2)
    await adminPool.query(`ALTER TABLE partida DISABLE TRIGGER no_delete_partida`);
    await adminPool.query(`DELETE FROM partida WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE partida ENABLE TRIGGER no_delete_partida`);

    // Limpiar proyectos
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);

    // Resto de entidades (usuario_rol_empresa, rol_permiso, usuario, rol, empresa, tenant)
    await adminPool.query(
      `DELETE FROM usuario_rol_empresa WHERE tenant_id IN ($1, $2)`,
      [tenantId, tenant2Id],
    );
    await adminPool.query(`DELETE FROM rol_permiso WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);

    await adminPool.query(`ALTER TABLE usuario DISABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`DELETE FROM usuario WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE usuario ENABLE TRIGGER no_delete_usuario`);

    await adminPool.query(`ALTER TABLE rol DISABLE TRIGGER no_delete_rol`);
    await adminPool.query(`DELETE FROM rol WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE rol ENABLE TRIGGER no_delete_rol`);

    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);

    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);

    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);

    await adminPool.end();
  });

  // ── Test 01: Crear capítulo ───────────────────────────────────────────────

  it('01: crear capítulo → nivel=1, orden=1, numeroJerarquico="1"', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codigo: 'C01', nombre: 'Obras Preliminares' })
      .expect(201);

    expect(res.body.nivel).toBe(1);
    expect(res.body.orden).toBe(1);
    expect(res.body.numeroJerarquico).toBe('1');
    expect(res.body.parentId).toBeNull();
    cap1Id = res.body.id as string;
  });

  // ── Test 02: Segundo capítulo ─────────────────────────────────────────────

  it('02: segundo capítulo → nivel=1, orden=2, numeroJerarquico="2"', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codigo: 'C02', nombre: 'Estructuras' })
      .expect(201);

    expect(res.body.nivel).toBe(1);
    expect(res.body.orden).toBe(2);
    expect(res.body.numeroJerarquico).toBe('2');
  });

  // ── Test 03: Partida bajo capítulo 1 ─────────────────────────────────────

  it('03: partida bajo capítulo 1 → nivel=2, orden=1, numeroJerarquico="1.1"', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        codigo: 'P0101',
        nombre: 'Demolición',
        parentId: cap1Id,
        cantidadPresupuestada: '150.0000',
        precioUnitario: '850.0000',
      })
      .expect(201);

    expect(res.body.nivel).toBe(2);
    expect(res.body.orden).toBe(1);
    expect(res.body.numeroJerarquico).toBe('1.1');
    expect(res.body.parentId).toBe(cap1Id);
    expect(res.body.cantidadPresupuestada).toBe('150.0000');
    expect(res.body.precioUnitario).toBe('850.0000');
    part1Id = res.body.id as string;
  });

  // ── Test 04: Segunda partida bajo capítulo 1 ─────────────────────────────

  it('04: segunda partida bajo capítulo 1 → nivel=2, orden=2, numeroJerarquico="1.2"', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codigo: 'P0102', nombre: 'Limpieza de terreno', parentId: cap1Id })
      .expect(201);

    expect(res.body.nivel).toBe(2);
    expect(res.body.orden).toBe(2);
    expect(res.body.numeroJerarquico).toBe('1.2');
    part2Id = res.body.id as string;
  });

  // ── Test 05: Sub-partida bajo partida 1.1 ────────────────────────────────

  it('05: sub-partida bajo "1.1" → nivel=3, orden=1, numeroJerarquico="1.1.1"', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        codigo: 'SP010101',
        nombre: 'Demolición manual con pico y pala',
        parentId: part1Id,
        cantidadPresupuestada: '100.0000',
      })
      .expect(201);

    expect(res.body.nivel).toBe(3);
    expect(res.body.orden).toBe(1);
    expect(res.body.numeroJerarquico).toBe('1.1.1');
    subId = res.body.id as string;
  });

  // ── Test 06: Código duplicado en mismo proyecto ───────────────────────────

  it('06: código duplicado en mismo proyecto → 409', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codigo: 'C01', nombre: 'Duplicado' })
      .expect(409);
  });

  // ── Test 07: Nivel 4 → 422 ────────────────────────────────────────────────

  it('07: crear nivel 4 (sub-sub-partida) → 422', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        codigo: 'SSP0101010101',
        nombre: 'Nivel demasiado profundo',
        parentId: subId,
      })
      .expect(422);

    expect(res.body.message).toContain('nivel máximo');
  });

  // ── Test 08: Reordenar — la partida "1.1" pasa a posición 2 ──────────────
  //   ANTES: part1="1.1" (ord=1), part2="1.2" (ord=2)
  //   DESPUÉS: part2="1.1" (ord=1), part1="1.2" (ord=2)

  it('08: reordenar part1 a posición 2 → part1.numeroJerarquico="1.2", part2="1.1"', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/proyectos/${proyectoId}/edt/${part1Id}/reordenar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nuevaPosicion: 2 })
      .expect(200);

    const hermanos: { id: string; numeroJerarquico: string; orden: number }[] = res.body as [];

    const updatedPart1 = hermanos.find((h) => h.id === part1Id);
    const updatedPart2 = hermanos.find((h) => h.id === part2Id);

    // Verificar los valores concretos — no solo que no hubo error
    expect(updatedPart1?.numeroJerarquico).toBe('1.2');
    expect(updatedPart1?.orden).toBe(2);
    expect(updatedPart2?.numeroJerarquico).toBe('1.1');
    expect(updatedPart2?.orden).toBe(1);
  });

  // ── Test 09: Sub-árbol actualizado tras reorden ───────────────────────────
  //   La sub-partida que era "1.1.1" (hijo de part1 que era "1.1") ahora debe ser "1.2.1"
  //   porque part1 pasó de "1.1" a "1.2"

  it('09: sub-árbol propagado — sub-partida "1.1.1" ahora es "1.2.1"', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoId}/edt/${subId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Valor exacto verificado — esta es la prueba más importante de la sesión
    expect(res.body.numeroJerarquico).toBe('1.2.1');
    expect(res.body.orden).toBe(1); // orden dentro de part1 no cambió
  });

  // ── Test 10: Borrar capítulo con hijos → 422 ─────────────────────────────

  it('10: soft-delete capítulo con partidas activas → 422', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/proyectos/${proyectoId}/edt/${cap1Id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(422);

    expect(res.body.message).toContain('sub-partidas activas');
  });

  // ── Test 11: Borrar partida con movimientos → 409 ─────────────────────────

  it('11: soft-delete partida con movimientos en el Ledger → 409', async () => {
    // Insertar un evento que imputa a la sub-partida (simula un consumo)
    await adminPool.query(
      `INSERT INTO evento_operativo
         (id, tenant_id, empresa_id, proyecto_id, partida_id,
          tipo_evento, usuario_id, payload, idempotency_key, estado, created_by)
       VALUES ($1, $2, $3, $4, $5,
          'consumo_material', $6,
          '{"insumo_id":"00000000-0000-0000-0000-000000000001","cantidad":"5.0000","unidad":"M3"}',
          $7, 'registrado', $6)`,
      [newId(), tenantId, empresaId, proyectoId, subId, usuarioId, `test-edt-11-${Date.now()}`],
    );

    const res = await request(app.getHttpServer())
      .delete(`/api/v1/proyectos/${proyectoId}/edt/${subId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    expect(res.body.message).toContain('movimientos');
  });

  // ── Test 12: Código igual en proyecto diferente → 201 ────────────────────

  it('12: mismo código en proyecto diferente (mismo tenant) → 201', async () => {
    // Crear un segundo proyecto en el mismo tenant
    const proyecto2LocalId = newId();
    await db.insert(schema.proyectos).values({
      id: proyecto2LocalId,
      tenantId,
      empresaId,
      codigo: 'P-EDT-02',
      nombre: 'Proyecto 2 local',
      tipoObra: 'COMERCIAL',
      clienteId,
      estado: 'PROSPECTO',
      createdBy: usuarioId,
      updatedBy: usuarioId,
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyecto2LocalId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codigo: 'C01', nombre: 'Capítulo 1 en otro proyecto' })
      .expect(201);

    expect(res.body.codigo).toBe('C01');
    expect(res.body.proyectoId).toBe(proyecto2LocalId);

    // Limpiar el proyecto local extra (soft-delete la partida, luego el proyecto)
    await adminPool.query(`ALTER TABLE partida DISABLE TRIGGER no_delete_partida`);
    await adminPool.query(`DELETE FROM partida WHERE proyecto_id = $1`, [proyecto2LocalId]);
    await adminPool.query(`ALTER TABLE partida ENABLE TRIGGER no_delete_partida`);
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE id = $1`, [proyecto2LocalId]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);
  });

  // ── Test 13: Aislamiento RLS ──────────────────────────────────────────────

  it('13: aislamiento RLS — tenant1 no ve EDT de tenant2; tenant2 sí ve la suya', async () => {
    // token (tenant1) intenta GET al proyecto de tenant2 → 404 (RLS lo oculta)
    await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyecto2Id}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    // token2 (tenant2) crea una partida y la recupera sin problemas
    const createRes = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyecto2Id}/edt`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ codigo: 'C01-T2', nombre: 'Capítulo T2' })
      .expect(201);

    expect(createRes.body.tenantId).toBe(tenant2Id);

    // GET árbol de tenant2 → solo ve su propia partida, no la del tenant1
    const treeRes = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyecto2Id}/edt`)
      .set('Authorization', `Bearer ${token2}`)
      .expect(200);

    const ids = (treeRes.body as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(createRes.body.id as string);
    expect(ids).not.toContain(cap1Id); // cap1Id pertenece al tenant1
  });

  // ── Test 14: GET árbol — orden jerárquico correcto ────────────────────────

  it('14: GET árbol devuelve partidas en orden numérico correcto', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const tree: { numeroJerarquico: string }[] = res.body as [];

    // Debe haber al menos 5 nodos: cap1, cap2, part1, part2, sub
    expect(tree.length).toBeGreaterThanOrEqual(5);

    // El primer elemento debe ser el capítulo 1 ("1"), no una partida ("1.1")
    expect(tree[0]?.numeroJerarquico).toBe('1');

    // Verificar que "1" aparece antes que "1.1" y "2"
    const indices: Record<string, number> = {};
    tree.forEach((n, i) => { indices[n.numeroJerarquico] = i; });

    // Después del reorden: part2 es "1.1", part1 es "1.2", sub es "1.2.1"
    expect(indices['1']).toBeLessThan(indices['1.1']!);
    expect(indices['1.1']).toBeLessThan(indices['1.2']!);
    expect(indices['1.2']).toBeLessThan(indices['1.2.1']!);
    expect(indices['1.2.1']).toBeLessThan(indices['2']!);
  });

  // ── Test 15: Soft-delete de partida sin hijos ni movimientos ─────────────

  it('15: soft-delete partida sin hijos → 204; desaparece del árbol', async () => {
    // Crear una partida temporal sin hijos
    const tmpRes = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codigo: 'TEMP_DEL', nombre: 'Temporal para delete' })
      .expect(201);
    const tmpId = tmpRes.body.id as string;

    // Soft-delete
    await request(app.getHttpServer())
      .delete(`/api/v1/proyectos/${proyectoId}/edt/${tmpId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    // Ya no aparece en el árbol
    const tree = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoId}/edt`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const ids = (tree.body as { id: string }[]).map((p) => p.id);
    expect(ids).not.toContain(tmpId);

    // GET directo → 404
    await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoId}/edt/${tmpId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
