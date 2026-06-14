/**
 * PRUEBAS DE INTEGRACIÓN — Gestor Documental + Notificaciones (Sesión 10 Capa 0)
 *
 *   1. Subir archivo: crea registro archivo + version_archivo v1, storage_key correcto.
 *   2. Subir nueva versión: version_actual sube a 2; v1 sigue accesible en BD.
 *   3. Listado por entidad: solo devuelve archivos de la entidad correcta.
 *   4. Próximos vencimientos: archivo con fecha_vencimiento en 10 días aparece en lista.
 *   5. Alerta de vencimiento: archivo elegible (fecha - alerta_dias_antes <= hoy) es detectado.
 *   6. Crear notificación in-app: fila insertada, leida=false, enviada_en se establece.
 *   7. Marcar notificación como leída: leida=true, leida_en no nulo.
 *
 * Requieren Docker corriendo: `docker compose up -d postgres minio`
 * Requieren las nueve migraciones aplicadas: 0000_tenancy → 0008_documental_notificaciones.
 * Correr con: pnpm --filter @tributia/api test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import type { DbService } from '../../database/db.service.js';
import type { StorageService } from '../../storage/storage.service.js';
import { ArchivoService } from '../archivo.service.js';
import { NotificacionService } from '../../notificaciones/notificacion.service.js';

// ─── Conexiones ──────────────────────────────────────────────────────────────

const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDbService(adminDb: NodePgDatabase<typeof schema>): DbService {
  return {
    get tx() { return adminDb; },
    get adminDb() { return adminDb; },
  } as unknown as DbService;
}

/** Mock de StorageService: sube nada pero devuelve URLs fake. */
function makeStorageMock(): StorageService {
  return {
    upload: (key: string, body: Buffer) =>
      Promise.resolve({ key, bucket: 'tributia-docs', contentType: 'application/octet-stream', size: body.length }),
    getPresignedDownloadUrl: (key: string) =>
      Promise.resolve(`https://minio.local/${key}?token=fake`),
    deleteObject: () => Promise.resolve(),
    bucketName: 'tributia-docs',
  } as unknown as StorageService;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Gestor Documental + Notificaciones — integración', () => {
  let adminPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;
  let archivoService: ArchivoService;
  let notificacionService: NotificacionService;

  let tenantId: string;
  const userId = newId();
  const entidadId = newId();
  const entidadTipo = 'orden_compra';

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    adminDb   = drizzle(adminPool, { schema });

    tenantId = newId();
    await adminDb.insert(schema.tenants).values({
      id: tenantId,
      nombre: 'Constructora Documental [test]',
      slug: `test-doc-${tenantId.slice(0, 8)}`,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    const db = makeDbService(adminDb);
    const storage = makeStorageMock();

    archivoService      = new ArchivoService(db, storage);
    notificacionService = new NotificacionService(db, []);
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM notificacion  WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM version_archivo WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM archivo        WHERE tenant_id = $1`, [tenantId]);
    await adminDb.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await adminPool.end();
  });

  // ─── 1. Subir archivo (v1) ────────────────────────────────────────────────

  it('1. subirArchivo crea archivo + version_archivo v1 con storage_key correcto', async () => {
    const buffer = Buffer.from('contenido de prueba');

    const archivo = await archivoService.subirArchivo(
      tenantId, userId,
      {
        nombre: 'poliza-fidelidad.pdf',
        descripcion: 'Póliza de fidelidad proveedor',
        entidadTipo,
        entidadId,
        categoria: 'POLIZA',
        fechaVencimiento: null,
        alertaDiasAntes: null,
        notaVersion: 'Versión inicial',
      },
      buffer,
      'application/pdf',
    );

    expect(archivo.tenantId).toBe(tenantId);
    expect(archivo.nombre).toBe('poliza-fidelidad.pdf');
    expect(archivo.versionActual).toBe(1);
    expect(archivo.categoria).toBe('POLIZA');
    expect(archivo.storageKey).toContain(tenantId);
    expect(archivo.storageKey).toContain('/v1/');
    expect(archivo.tamanoBytesActual).toBe(buffer.length);

    // Verificar version_archivo v1
    const [v1] = await adminDb
      .select()
      .from(schema.versionesArchivo)
      .where(
        and(
          eq(schema.versionesArchivo.archivoId, archivo.id),
          eq(schema.versionesArchivo.numeroVersion, 1),
        ),
      );

    expect(v1).toBeDefined();
    expect(v1!.checksumSha256).toHaveLength(64);
    expect(v1!.nota).toBe('Versión inicial');
  });

  // ─── 2. Subir nueva versión ───────────────────────────────────────────────

  it('2. subirNuevaVersion incrementa version_actual a 2; v1 sigue en BD', async () => {
    // Crear archivo base
    const base = await archivoService.subirArchivo(
      tenantId, userId,
      {
        nombre: 'contrato-subcontrato.docx',
        descripcion: null,
        entidadTipo,
        entidadId: newId(),
        categoria: 'CONTRATO',
        fechaVencimiento: null,
        alertaDiasAntes: null,
        notaVersion: null,
      },
      Buffer.from('v1 contenido'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(base.versionActual).toBe(1);

    // Subir v2
    const v2Buffer = Buffer.from('v2 contenido actualizado');
    const updated = await archivoService.subirNuevaVersion(
      base.id, tenantId, userId,
      { notaVersion: 'Corrección de cláusulas' },
      v2Buffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(updated.versionActual).toBe(2);
    expect(updated.storageKey).toContain('/v2/');
    expect(updated.tamanoBytesActual).toBe(v2Buffer.length);

    // v1 sigue en BD
    const versiones = await archivoService.getVersiones(base.id);
    expect(versiones).toHaveLength(2);
    expect(versiones.map((v) => v.numeroVersion)).toEqual([1, 2]);
    expect(versiones[1]!.nota).toBe('Corrección de cláusulas');
  });

  // ─── 3. Listado por entidad ───────────────────────────────────────────────

  it('3. listByEntidad devuelve solo los archivos de esa entidad', async () => {
    const miEntidadId = newId();
    const otraEntidadId = newId();

    await archivoService.subirArchivo(
      tenantId, userId,
      { nombre: 'a.pdf', descripcion: null, entidadTipo, entidadId: miEntidadId, categoria: 'OTRO', fechaVencimiento: null, alertaDiasAntes: null, notaVersion: null },
      Buffer.from('a'),
      'application/pdf',
    );

    await archivoService.subirArchivo(
      tenantId, userId,
      { nombre: 'b.pdf', descripcion: null, entidadTipo, entidadId: miEntidadId, categoria: 'OTRO', fechaVencimiento: null, alertaDiasAntes: null, notaVersion: null },
      Buffer.from('b'),
      'application/pdf',
    );

    await archivoService.subirArchivo(
      tenantId, userId,
      { nombre: 'c.pdf', descripcion: null, entidadTipo, entidadId: otraEntidadId, categoria: 'OTRO', fechaVencimiento: null, alertaDiasAntes: null, notaVersion: null },
      Buffer.from('c'),
      'application/pdf',
    );

    const resultado = await archivoService.listByEntidad(tenantId, entidadTipo, miEntidadId);
    expect(resultado).toHaveLength(2);
    expect(resultado.every((a) => a.entidadId === miEntidadId)).toBe(true);
  });

  // ─── 4. Próximos vencimientos ─────────────────────────────────────────────

  it('4. listProximosVencimientos incluye archivo con vencimiento en 10 días', async () => {
    const vencimiento10 = new Date();
    vencimiento10.setDate(vencimiento10.getDate() + 10);
    const fechaStr = vencimiento10.toISOString().split('T')[0]!;

    await archivoService.subirArchivo(
      tenantId, userId,
      {
        nombre: 'fianza-ejecucion.pdf',
        descripcion: null,
        entidadTipo,
        entidadId: newId(),
        categoria: 'FIANZA',
        fechaVencimiento: fechaStr,
        alertaDiasAntes: 15,
        notaVersion: null,
      },
      Buffer.from('fianza'),
      'application/pdf',
    );

    const proximos = await archivoService.listProximosVencimientos(tenantId, 30);
    const encontrado = proximos.find((a) => a.fechaVencimiento === fechaStr);
    expect(encontrado).toBeDefined();
    expect(encontrado!.categoria).toBe('FIANZA');
  });

  // ─── 5. Detección de alerta de vencimiento ────────────────────────────────

  it('5. listParaAlertaHoy detecta archivo que debe alertar hoy', async () => {
    // Archivo con fecha_vencimiento = hoy + 5 días, alerta_dias_antes = 10
    // → fecha_vencimiento - 10 = hoy - 5 ≤ hoy → debe alertar
    const fechaVenc = new Date();
    fechaVenc.setDate(fechaVenc.getDate() + 5);
    const fechaStr = fechaVenc.toISOString().split('T')[0]!;

    await archivoService.subirArchivo(
      tenantId, userId,
      {
        nombre: 'seguro-equipo.pdf',
        descripcion: null,
        entidadTipo,
        entidadId: newId(),
        categoria: 'POLIZA',
        fechaVencimiento: fechaStr,
        alertaDiasAntes: 10,
        notaVersion: null,
      },
      Buffer.from('seguro'),
      'application/pdf',
    );

    const parAlertar = await archivoService.listParaAlertaHoy(tenantId);
    const encontrado = parAlertar.find((a) => a.fechaVencimiento === fechaStr);
    expect(encontrado).toBeDefined();
  });

  // ─── 6. Crear notificación in-app ─────────────────────────────────────────

  it('6. crear notificación in-app: leida=false, enviada_en se establece pronto', async () => {
    const notif = await notificacionService.crear(tenantId, SYSTEM_USER_ID, {
      usuarioId: userId,
      tipo: 'VENCIMIENTO_DOCUMENTO',
      canal: 'IN_APP',
      asunto: 'Documento por vencer',
      cuerpo: 'Tu póliza vence en 5 días.',
      referenciaTipo: 'archivo',
      referenciaId: newId(),
    });

    expect(notif.tenantId).toBe(tenantId);
    expect(notif.usuarioId).toBe(userId);
    expect(notif.leida).toBe(false);
    expect(notif.canal).toBe('IN_APP');

    // Esperar despacho async (marcarEnviada)
    await new Promise((res) => setTimeout(res, 100));

    const [actualizada] = await adminDb
      .select()
      .from(schema.notificaciones)
      .where(eq(schema.notificaciones.id, notif.id));

    expect(actualizada!.enviadaEn).not.toBeNull();
  });

  // ─── 7. Marcar notificación como leída ───────────────────────────────────

  it('7. marcarLeida: leida=true y leida_en no nulo', async () => {
    const notif = await notificacionService.crear(tenantId, SYSTEM_USER_ID, {
      usuarioId: userId,
      tipo: 'SISTEMA',
      canal: 'IN_APP',
      asunto: 'Bienvenido',
      cuerpo: 'Tu cuenta está lista.',
      referenciaTipo: null,
      referenciaId: null,
    });

    expect(notif.leida).toBe(false);

    const leida = await notificacionService.marcarLeida(notif.id, userId);
    expect(leida.leida).toBe(true);
    expect(leida.leidaEn).not.toBeNull();

    // pendientesPorUsuario ya no la incluye
    const pendientes = await notificacionService.pendientesPorUsuario(userId, tenantId);
    expect(pendientes.find((n) => n.id === notif.id)).toBeUndefined();
  });
});
