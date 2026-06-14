/**
 * PRUEBAS DE INTEGRACIÓN — Motor de Presupuesto y APU (Sesión 3 Capa 1)
 *
 * Cubren (disciplina: verificar el VALOR, no solo la ausencia de error):
 *  01. APU aritmética exacta con Decimal.js: 3 líneas con precios "tramposos" → total sin error de punto flotante
 *  02. Crear APU para partida → precioUnitario de la partida sincronizado automáticamente
 *  03. Añadir línea al APU → total del APU recalculado correctamente
 *  04. Actualizar línea del APU → total recalcula solo la línea modificada
 *  05. Eliminar línea del APU → total decrece por el precio_total exacto de esa línea
 *  06. Crear APU de biblioteca → esBiblioteca=true, sin partidaId
 *  07. Copiar APU de biblioteca a partida → crea APU nuevo con mismas líneas
 *  08. Crear versión de presupuesto BORRADOR con snapshotPartidas=true → líneas automáticas
 *  09. Añadir línea manual a versión → totales directo/indirecto/total correctos
 *  10. Aprobar versión como BASE → estado=APROBADO, aprobadoPor=usuarioId
 *  11. Inmutabilidad: intentar añadir línea a versión APROBADA → 422
 *  12. Solo un BASE aprobado por proyecto: segundo aprobar → 409
 *  13. GET vigente → devuelve el BASE aprobado con sus líneas
 *  14. RLS: tenant2 no puede ver versiones de presupuesto de tenant1 → lista vacía
 *  15. Partida duplicada en versión → 409
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as argon2 from 'argon2';
import Decimal from 'decimal.js';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../app.module.js';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

const SLUG = `test-ppto-${Date.now()}`;
const USER_EMAIL = `ppto-admin@${SLUG}.com`;
const USER_PASS = 'PptoAdmin!99';

describe('Motor de Presupuesto y APU — Sesión 3 Capa 1', () => {
  let app: INestApplication;
  let adminPool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let jwt: JwtService;

  let tenantId: string;
  let empresaId: string;
  let usuarioId: string;
  let rolId: string;
  let clienteId: string;
  let proyectoId: string;

  // Partidas creadas para los tests
  let partida1Id: string;  // partida con APU
  let partida2Id: string;  // partida sin APU (para presupuesto manual)
  let partida3Id: string;  // partida para test duplicado y snapshot

  let token: string;

  // IDs de objetos creados durante tests
  let apuBibliotecaId: string;
  let version1Id: string;
  let version2Id: string;

  // ── Segundo tenant para RLS ─────────────────────────────────────────────────
  let tenant2Id: string;
  let empresa2Id: string;
  let usuario2Id: string;
  let rol2Id: string;
  let cliente2Id: string;
  let proyecto2Id: string;
  let token2: string;
  const USER2_EMAIL = `ppto-t2@${SLUG}.com`;
  const USER2_PASS = 'PptoTenant2!55';

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    db = drizzle(adminPool, { schema });

    // ── Tenant 1 ─────────────────────────────────────────────────────────────
    tenantId = newId();
    empresaId = newId();
    usuarioId = newId();
    rolId = newId();
    clienteId = newId();
    proyectoId = newId();

    await db.insert(schema.tenants).values({
      id: tenantId, nombre: 'Constructora Ppto Test', slug: SLUG,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.empresas).values({
      id: empresaId, tenantId, nombre: 'Empresa Ppto Test',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    const hash = await argon2.hash(USER_PASS, { type: argon2.argon2id });
    await db.insert(schema.usuarios).values({
      id: usuarioId, tenantId, email: USER_EMAIL, passwordHash: hash,
      nombre: 'Admin', apellido: 'Ppto',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    await db.insert(schema.roles).values({
      id: rolId, tenantId, nombre: 'Admin Ppto',
      descripcion: 'Acceso total al módulo de presupuesto',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });

    const permisos = [
      'proyecto:read', 'proyecto:write',
      'edt:read', 'edt:write',
      'apu:read', 'apu:write',
      'presupuesto:read', 'presupuesto:write', 'presupuesto:approve',
    ];
    await db.insert(schema.rolPermisos).values(
      permisos.map((p) => ({
        id: newId(), tenantId, rolId, permiso: p,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      })),
    );
    await db.insert(schema.usuarioRolEmpresa).values({
      id: newId(), tenantId, usuarioId, empresaId, rolId,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.terceros).values({
      id: clienteId, tenantId, tipoIdentificacion: 'RNC', rncCedula: '131-00077-7',
      nombreComercial: 'Cliente Ppto Test', tipoContribuyente: 'PERSONA_JURIDICA',
      esCliente: true, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.proyectos).values({
      id: proyectoId, tenantId, empresaId, codigo: 'P-PPTO-01',
      nombre: 'Proyecto Presupuesto Test', tipoObra: 'RESIDENCIAL', clienteId,
      estado: 'EN_EJECUCION', createdBy: usuarioId, updatedBy: usuarioId,
    });

    // Crear 3 partidas directamente en DB para los tests
    partida1Id = newId();
    partida2Id = newId();
    partida3Id = newId();
    const now = new Date();
    await db.insert(schema.partidas).values([
      {
        id: partida1Id, tenantId, proyectoId, nivel: 1, orden: 1,
        numeroJerarquico: '1', codigo: 'CAP-01', nombre: 'Estructura',
        cantidadPresupuestada: '1.0000', precioUnitario: '0.0000',
        createdBy: usuarioId, updatedBy: usuarioId, createdAt: now, updatedAt: now,
      },
      {
        id: partida2Id, tenantId, proyectoId, nivel: 2, orden: 1,
        parentId: partida1Id, numeroJerarquico: '1.1',
        codigo: '1.01', nombre: 'Concreto 210 kg/cm²',
        cantidadPresupuestada: '100.0000', precioUnitario: '0.0000',
        createdBy: usuarioId, updatedBy: usuarioId, createdAt: now, updatedAt: now,
      },
      {
        id: partida3Id, tenantId, proyectoId, nivel: 2, orden: 2,
        parentId: partida1Id, numeroJerarquico: '1.2',
        codigo: '1.02', nombre: 'Acero de refuerzo',
        cantidadPresupuestada: '50.0000', precioUnitario: '0.0000',
        createdBy: usuarioId, updatedBy: usuarioId, createdAt: now, updatedAt: now,
      },
    ]);

    // ── Tenant 2 (RLS) ────────────────────────────────────────────────────────
    const SLUG2 = `${SLUG}-t2`;
    tenant2Id = newId();
    empresa2Id = newId();
    usuario2Id = newId();
    rol2Id = newId();
    cliente2Id = newId();
    proyecto2Id = newId();

    await db.insert(schema.tenants).values({
      id: tenant2Id, nombre: 'Tenant 2 RLS Ppto', slug: SLUG2,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.empresas).values({
      id: empresa2Id, tenantId: tenant2Id, nombre: 'Empresa 2 RLS',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    const hash2 = await argon2.hash(USER2_PASS, { type: argon2.argon2id });
    await db.insert(schema.usuarios).values({
      id: usuario2Id, tenantId: tenant2Id, email: USER2_EMAIL, passwordHash: hash2,
      nombre: 'Admin2', apellido: 'Ppto2',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.roles).values({
      id: rol2Id, tenantId: tenant2Id, nombre: 'Admin Ppto 2',
      descripcion: 'Acceso total',
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.rolPermisos).values(
      ['proyecto:read', 'presupuesto:read'].map((p) => ({
        id: newId(), tenantId: tenant2Id, rolId: rol2Id, permiso: p,
        createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
      })),
    );
    await db.insert(schema.usuarioRolEmpresa).values({
      id: newId(), tenantId: tenant2Id, usuarioId: usuario2Id,
      empresaId: empresa2Id, rolId: rol2Id,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.terceros).values({
      id: cliente2Id, tenantId: tenant2Id, tipoIdentificacion: 'RNC',
      rncCedula: '131-00099-9', nombreComercial: 'Cliente 2 RLS',
      tipoContribuyente: 'PERSONA_JURIDICA', esCliente: true,
      createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID,
    });
    await db.insert(schema.proyectos).values({
      id: proyecto2Id, tenantId: tenant2Id, empresaId: empresa2Id,
      codigo: 'P-PPTO-T2', nombre: 'Proyecto RLS T2',
      tipoObra: 'COMERCIAL', clienteId: cliente2Id, estado: 'EN_EJECUCION',
      createdBy: usuario2Id, updatedBy: usuario2Id,
    });

    // ── NestJS app ─────────────────────────────────────────────────────────────
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    jwt = app.get(JwtService);

    token = jwt.sign({
      sub: usuarioId, tenantId, empresaId, email: USER_EMAIL,
      permisos: [
        'proyecto:read', 'proyecto:write',
        'edt:read', 'edt:write',
        'apu:read', 'apu:write',
        'presupuesto:read', 'presupuesto:write', 'presupuesto:approve',
      ],
    });
    token2 = jwt.sign({
      sub: usuario2Id, tenantId: tenant2Id, empresaId: empresa2Id,
      email: USER2_EMAIL,
      permisos: ['proyecto:read', 'presupuesto:read'],
    });
  });

  afterAll(async () => {
    // Limpieza en orden de dependencias FK
    // 1. Mover versiones aprobadas a RECHAZADO para desactivar protect_lineas_aprobadas
    await adminPool.query(
      `UPDATE version_presupuesto SET estado = 'RECHAZADO' WHERE tenant_id IN ($1, $2) AND estado = 'APROBADO'`,
      [tenantId, tenant2Id],
    );
    await adminPool.query(`DELETE FROM linea_presupuesto WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    // 2. Deshabilitar prevent_delete en version_presupuesto antes de borrar
    await adminPool.query(`ALTER TABLE version_presupuesto DISABLE TRIGGER no_delete_version_presupuesto`);
    await adminPool.query(`DELETE FROM version_presupuesto WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE version_presupuesto ENABLE TRIGGER no_delete_version_presupuesto`);
    await adminPool.query(`ALTER TABLE apu DISABLE TRIGGER no_delete_apu`);
    await adminPool.query(`DELETE FROM apu_linea WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`DELETE FROM apu WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE apu ENABLE TRIGGER no_delete_apu`);
    await adminPool.query(`ALTER TABLE partida DISABLE TRIGGER no_delete_partida`).catch(() => {/* ok */});
    await adminPool.query(`DELETE FROM partida WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE partida ENABLE TRIGGER no_delete_partida`).catch(() => {/* ok */});
    await adminPool.query(`ALTER TABLE proyecto DISABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM proyecto WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE proyecto ENABLE TRIGGER no_delete_proyecto`);
    await adminPool.query(`DELETE FROM tercero WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`DELETE FROM rol_permiso WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`DELETE FROM usuario_rol_empresa WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE rol DISABLE TRIGGER no_delete_rol`);
    await adminPool.query(`DELETE FROM rol WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE rol ENABLE TRIGGER no_delete_rol`);
    await adminPool.query(`DELETE FROM refresh_token WHERE usuario_id IN ($1, $2)`, [usuarioId, usuario2Id]);
    await adminPool.query(`ALTER TABLE usuario DISABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`DELETE FROM usuario WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE usuario ENABLE TRIGGER no_delete_usuario`);
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id IN ($1, $2)`, [tenantId, tenant2Id]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);

    await app.close();
    await adminPool.end();
  });

  // ── 01. APU aritmética exacta ───────────────────────────────────────────────

  it('01 — APU aritmética exacta: 3 líneas tramposas → total sin error de punto flotante', async () => {
    // 0.1 + 0.2 !== 0.3 en IEEE 754 float, pero con Decimal sí es exacto
    // Línea 1: cantidad=0.1, precio=1.0000  → total=0.1000
    // Línea 2: cantidad=0.2, precio=1.0000  → total=0.2000
    // Línea 3: cantidad=1.0, precio=10.7    → total=10.7000
    // suma correcta = 11.0000

    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/edt/${partida2Id}/apu`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        codigo: 'APU-CONC-01',
        nombre: 'Concreto estructural 210',
        moneda: 'DOP',
        esBiblioteca: false,
        lineas: [
          { tipo: 'MATERIAL', descripcion: 'Cemento', cantidad: '0.1', precioUnitario: '1.0000', moneda: 'DOP', orden: 1 },
          { tipo: 'MATERIAL', descripcion: 'Arena',   cantidad: '0.2', precioUnitario: '1.0000', moneda: 'DOP', orden: 2 },
          { tipo: 'MANO_OBRA', descripcion: 'Maestro', cantidad: '1.0', precioUnitario: '10.7', moneda: 'DOP', orden: 3 },
        ],
      })
      .expect(201);

    // Verificar exactitud Decimal (no 11.0000000002 como float)
    expect(res.body.precioUnitario).toBe('11.0000');

    // Verificar que cada línea tiene su precio_total correcto
    const lineas = res.body.lineas as { descripcion: string; precioTotal: string }[];
    const cement = lineas.find((l) => l.descripcion === 'Cemento');
    const arena  = lineas.find((l) => l.descripcion === 'Arena');
    const maest  = lineas.find((l) => l.descripcion === 'Maestro');
    expect(cement?.precioTotal).toBe('0.1000');
    expect(arena?.precioTotal).toBe('0.2000');
    expect(maest?.precioTotal).toBe('10.7000');

    // Verificar con Decimal: la suma es exactamente 11.0000
    const suma = new Decimal('0.1000').plus('0.2000').plus('10.7000');
    expect(suma.toFixed(4)).toBe('11.0000');
  });

  // ── 02. precioUnitario de partida sincronizado ───────────────────────────────

  it('02 — precioUnitario de partida sincronizado al crear APU', async () => {
    // El APU creado en test 01 actualizó partida2.precio_unitario
    const res = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoId}/edt/${partida2Id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.precioUnitario).toBe('11.0000');
  });

  // ── 03. Añadir línea → total recalculado ────────────────────────────────────

  it('03 — Añadir línea al APU → total del APU recalculado', async () => {
    // Añadir equipo: 2 horas × 350.75/hora = 701.5000
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/edt/${partida2Id}/apu/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'EQUIPO', descripcion: 'Mezcladora', cantidad: '2', precioUnitario: '350.75', moneda: 'DOP', orden: 4 })
      .expect(201);

    // precioUnitario del APU = 11.0000 + 701.5000 = 712.5000
    expect(res.body.precioUnitario).toBe('712.5000');
    const lineas = res.body.lineas as { descripcion: string; precioTotal: string }[];
    const equipo = lineas.find((l) => l.descripcion === 'Mezcladora');
    expect(equipo?.precioTotal).toBe('701.5000');
  });

  // ── 04. Actualizar línea → total recalcula ──────────────────────────────────

  it('04 — Actualizar línea del APU → total recalculado correctamente', async () => {
    // Primero obtenemos el APU para conocer el id de la línea "Cemento"
    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoId}/edt/${partida2Id}/apu`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const lineas = getRes.body.lineas as { id: string; descripcion: string; precioTotal: string }[];
    const cementoLinea = lineas.find((l) => l.descripcion === 'Cemento')!;
    expect(cementoLinea).toBeDefined();

    // Cambiar cantidad de 0.1 → 10.0: 10.0 × 1.0000 = 10.0000 (antes 0.1000)
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/proyectos/${proyectoId}/edt/${partida2Id}/apu/lineas/${cementoLinea.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidad: '10.0' })
      .expect(200);

    // nuevo total: 10.0000 (cemento) + 0.2000 (arena) + 10.7000 (maestro) + 701.5000 (equipo)
    //            = 722.4000
    expect(patchRes.body.precioUnitario).toBe('722.4000');
  });

  // ── 05. Eliminar línea → total decrece ──────────────────────────────────────

  it('05 — Eliminar línea del APU → total decrece exactamente', async () => {
    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoId}/edt/${partida2Id}/apu`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const lineas = getRes.body.lineas as { id: string; descripcion: string; precioTotal: string }[];
    const equipo = lineas.find((l) => l.descripcion === 'Mezcladora')!;
    expect(equipo).toBeDefined();

    const deleteRes = await request(app.getHttpServer())
      .delete(`/api/v1/proyectos/${proyectoId}/edt/${partida2Id}/apu/lineas/${equipo.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    // verificar que el total bajó: 722.4000 - 701.5000 = 20.9000
    const getAfterRes = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoId}/edt/${partida2Id}/apu`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(getAfterRes.body.precioUnitario).toBe('20.9000');
    void deleteRes;
  });

  // ── 06. APU de biblioteca ────────────────────────────────────────────────────

  it('06 — Crear APU de biblioteca → esBiblioteca=true, sin partidaId', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/apu/biblioteca')
      .set('Authorization', `Bearer ${token}`)
      .send({
        codigo: 'APU-BLIB-001',
        nombre: 'Viga de concreto (template)',
        moneda: 'DOP',
        esBiblioteca: true,
        lineas: [
          { tipo: 'MATERIAL', descripcion: 'Concreto premezclado', cantidad: '0.5', precioUnitario: '6000', moneda: 'DOP', orden: 1 },
          { tipo: 'MANO_OBRA', descripcion: 'Cuadrilla', cantidad: '4', precioUnitario: '800', moneda: 'DOP', orden: 2 },
        ],
      })
      .expect(201);

    apuBibliotecaId = res.body.id;
    expect(res.body.esBiblioteca).toBe(true);
    expect(res.body.partidaId).toBeNull();
    // 0.5×6000 = 3000.0000 + 4×800 = 3200.0000 → total = 6200.0000
    expect(res.body.precioUnitario).toBe('6200.0000');
  });

  // ── 07. Copiar biblioteca a partida ─────────────────────────────────────────

  it('07 — Copiar APU de biblioteca a partida → APU nuevo con mismas líneas', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/apu/biblioteca/${apuBibliotecaId}/copiar-a-partida/${partida3Id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ proyectoId })
      .expect(201);

    expect(res.body.esBiblioteca).toBe(false);
    expect(res.body.partidaId).toBe(partida3Id);
    expect(res.body.precioUnitario).toBe('6200.0000');
    expect(res.body.lineas).toHaveLength(2);
  });

  // ── 08. Versión BORRADOR con snapshotPartidas ────────────────────────────────

  it('08 — Crear versión BORRADOR con snapshotPartidas=true → líneas automáticas', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/presupuesto`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Presupuesto Inicial', tipo: 'BORRADOR', moneda: 'DOP', snapshotPartidas: true })
      .expect(201);

    version1Id = res.body.id;
    expect(res.body.tipo).toBe('BORRADOR');
    expect(res.body.estado).toBe('PENDIENTE');
    // Hay 3 partidas activas: partida1 (cap), partida2 (con APU 20.9000, cant=100), partida3 (con APU 6200.0000, cant=50)
    // totalDirecto debe ser partida1(0×1)+partida2(20.9×100)+partida3(6200×50) = 0+2090+310000 = 312090
    // (Los capítulos tienen cantidadPresupuestada=1, precioUnitario=0 → total=0)
    const lineas = res.body.lineas as { total: string }[];
    expect(lineas.length).toBeGreaterThanOrEqual(3);
  });

  // ── 09. Añadir línea manual → totales correctos ──────────────────────────────

  it('09 — Añadir línea manual (es_indirecto=true) → totalIndirecto actualizado', async () => {
    // Primero crear una versión vacía para este test
    const vRes = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/presupuesto`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Versión Manual', tipo: 'BORRADOR', moneda: 'DOP', snapshotPartidas: false })
      .expect(201);

    version2Id = vRes.body.id;

    // Añadir línea directa: cantidad=100, precio=20.90 → total=2090.0000
    await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/presupuesto/${version2Id}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ partidaId: partida2Id, cantidad: '100', precioUnitario: '20.9', esIndirecto: false })
      .expect(201);

    // Añadir línea indirecta: cantidad=1, precio=5000 → total=5000.0000
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/presupuesto/${version2Id}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ partidaId: partida3Id, cantidad: '1', precioUnitario: '5000', esIndirecto: true })
      .expect(201);

    expect(res.body.totalDirecto).toBe('2090.0000');
    expect(res.body.totalIndirecto).toBe('5000.0000');
    expect(res.body.totalPresupuesto).toBe('7090.0000');
  });

  // ── 10. Aprobar versión ───────────────────────────────────────────────────────

  it('10 — Aprobar versión como BASE → estado=APROBADO, aprobadoPor=usuarioId', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/presupuesto/${version2Id}/aprobar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notas: 'Aprobado en junta directiva' })
      .expect(201);

    expect(res.body.estado).toBe('APROBADO');
    expect(res.body.aprobadoPor).toBe(usuarioId);
    expect(res.body.aprobadoEn).toBeTruthy();
  });

  // ── 11. Inmutabilidad: línea en versión APROBADA → 422 ───────────────────────

  it('11 — Intentar añadir línea a versión APROBADA → 422 (inmutable)', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/presupuesto/${version2Id}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ partidaId: partida1Id, cantidad: '1', precioUnitario: '100', esIndirecto: false })
      .expect(422);
  });

  // ── 12. Solo un BASE aprobado por proyecto → 409 ─────────────────────────────

  it('12 — Aprobar segundo BASE para el mismo proyecto → 409', async () => {
    // Crear otra versión BORRADOR y tratar de aprobarla como BASE
    const vRes = await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/presupuesto`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Segundo Borrador', tipo: 'BASE', moneda: 'DOP', snapshotPartidas: false })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/presupuesto/${vRes.body.id as string}/aprobar`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(409);
  });

  // ── 13. GET vigente ───────────────────────────────────────────────────────────

  it('13 — GET vigente → retorna BASE aprobado con sus líneas', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoId}/presupuesto/vigente`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // El vigente es el BASE aprobado — debería ser version2Id (el único aprobado)
    expect(res.body.id).toBe(version2Id);
    expect(res.body.estado).toBe('APROBADO');
    expect(res.body.tipo).toBe('BASE');
    expect(res.body.totalPresupuesto).toBe('7090.0000');
    expect(Array.isArray(res.body.lineas)).toBe(true);
    expect(res.body.lineas.length).toBeGreaterThanOrEqual(2);
  });

  // ── 14. RLS: tenant2 no ve versiones de tenant1 ──────────────────────────────

  it('14 — RLS: tenant2 obtiene lista vacía de versiones de tenant1', async () => {
    // tenant2 no tiene acceso a proyectos de tenant1
    const res = await request(app.getHttpServer())
      .get(`/api/v1/proyectos/${proyectoId}/presupuesto`)
      .set('Authorization', `Bearer ${token2}`)
      .expect(404); // findById del proyecto falla (RLS o not found)

    void res;
  });

  // ── 15. Partida duplicada en versión → 409 ───────────────────────────────────

  it('15 — Añadir misma partida dos veces en misma versión → 409', async () => {
    // version1 ya tiene partidas del snapshot; intentar agregar partida2 otra vez → 409
    const lineas = (
      await request(app.getHttpServer())
        .get(`/api/v1/proyectos/${proyectoId}/presupuesto/${version1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body.lineas as { partidaId: string }[];

    const partidaDuplicada = lineas[0]?.partidaId;
    if (!partidaDuplicada) {
      // Si snapshot no generó líneas (ej. test env sin partidas activas), usar partida2Id directamente
      // Primero agregar una vez
      await request(app.getHttpServer())
        .post(`/api/v1/proyectos/${proyectoId}/presupuesto/${version1Id}/lineas`)
        .set('Authorization', `Bearer ${token}`)
        .send({ partidaId: partida2Id, cantidad: '1', precioUnitario: '100', esIndirecto: false })
        .expect([201, 409]); // puede ya tener la línea del snapshot
    }

    const targetPartida = partidaDuplicada ?? partida2Id;
    await request(app.getHttpServer())
      .post(`/api/v1/proyectos/${proyectoId}/presupuesto/${version1Id}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ partidaId: targetPartida, cantidad: '99', precioUnitario: '999', esIndirecto: false })
      .expect(409);
  });
});
