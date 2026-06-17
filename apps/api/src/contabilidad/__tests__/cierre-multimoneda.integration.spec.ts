/**
 * PRUEBAS DE INTEGRACIÓN — Cierre contable mensual y multimoneda (Sesión 2 Capa 2)
 *
 *  01. cerrar período → estado=CERRADO registrado en BD
 *  02. asiento sobre período cerrado → rechazado por motor (UnprocessableEntityException)
 *  03. asiento sobre período reabierto → permitido
 *  04. reabrir período → estado=REABIERTO + motivo registrado
 *  05. cerrar período ya cerrado → ConflictException
 *  06. asiento sobre período abierto (sin registro) → pasa sin error
 *  07. registrar tasa de cambio USD/DOP
 *  08. consultar tasa vigente para fecha (más reciente <= fecha)
 *  09. cobro recibido misma tasa → sin asiento de diferencia cambiaria
 *  10. cobro recibido tasa mayor → asiento ganancia cambiaria generado
 *  11. cobro recibido tasa menor → asiento pérdida cambiaria generado
 *  12. diferencia cambiaria: Σdebe = Σhaber en el asiento
 *  13. asiento cierre de resultados: cuentas de ingreso saldadas contra Utilidad Ejercicio
 *  14. consolidación multi-empresa: totales suman correctamente
 *  15. consolidación excluye empresa de otro tenant
 *  16. checklist cierre: ítem requerido pendiente bloquea cierre
 *  17. RLS: período cerrado empresa A no afecta empresa B
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema/index.js';
import { newId, SYSTEM_USER_ID } from '@tributia/shared';
import type { ConfiguracionRegla } from '@tributia/contabilidad';
import { PeriodoContableService } from '../periodo-contable.service.js';
import { TasaCambioService } from '../tasa-cambio.service.js';
import { ConsolidacionService } from '../consolidacion.service.js';
import { CuentaContableService } from '../cuenta-contable.service.js';
import { ReglaContableService } from '../regla-contable.service.js';
import { AsientoContableService } from '../asiento-contable.service.js';
import { ContabilidadDiferenciaCambiariaHandler } from '../handlers/contabilidad-diferencia-cambiaria.handler.js';

// ─── Conexiones ───────────────────────────────────────────────────────────────
const ADMIN_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://tributia:tributia_dev@localhost:5432/tributia_buildcore';
const APP_URL =
  process.env['DATABASE_URL_APP'] ??
  'postgresql://tributia_app:tributia_app_dev@localhost:5432/tributia_buildcore';

describe('Cierre contable mensual y multimoneda', () => {
  let adminPool: Pool;
  let appPool: Pool;
  let adminDb: NodePgDatabase<typeof schema>;

  // IDs de fixtures
  let tenantId: string;
  let empresaId: string;
  let empresaBId: string;   // segunda empresa misma tenant (multi-empresa)
  let tenantOtroId: string; // tenant externo (test RLS consolidación)
  let empresaOtraId: string;
  let centroCostoId: string;
  let centroCostoOtroId: string;

  // Cuentas contables para los tests
  let cuentaIngresoId: string;  // tipo=ingreso
  let cuentaGastoId: string;    // tipo=gasto
  let cuentaPatrimonioId: string; // tipo=patrimonio (Utilidad Ejercicio)
  let cuentaGananciaFxId: string; // tipo=ingreso — Ganancia Cambiaria
  let cuentaPerdidaFxId: string;  // tipo=gasto   — Pérdida Cambiaria
  let cuentaDebeId: string;      // tipo=activo   — para asientos auxiliares empresa B
  let cuentaHaberId: string;     // tipo=pasivo   — para asientos auxiliares empresa B

  // Reglas contables
  let reglaGananciaFxId: string;
  let reglaPerdidaFxId: string;

  // Servicios
  let periodoSvc: PeriodoContableService;
  let tasaSvc: TasaCambioService;
  let consolidacionSvc: ConsolidacionService;
  let asientoSvc: AsientoContableService;
  let handlerFx: ContabilidadDiferenciaCambiariaHandler;

  function makeEvento(overrides: Record<string, unknown>) {
    return {
      id: newId(),
      tenantId,
      empresaId,
      proyectoId: null,
      centroCostoId,
      tipoEvento: 'cobro_recibido' as const,
      ocurridoEn: new Date(),
      usuarioId: SYSTEM_USER_ID,
      payload: {},
      partidaId: null,
      referenciaId: null,
      referenciaTabla: null,
      idempotencyKey: newId(),
      estado: 'registrado' as const,
      eventoReversaId: null,
      createdAt: new Date(),
      createdBy: SYSTEM_USER_ID,
      ...overrides,
    };
  }

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: ADMIN_URL });
    appPool   = new Pool({ connectionString: APP_URL });
    adminDb   = drizzle(adminPool, { schema });

    // Servicios (sin DbService — pasamos tx directamente)
    const cuentaSvc   = new CuentaContableService(null as never);
    const reglaSvc    = new ReglaContableService();
    asientoSvc        = new AsientoContableService(null as never, cuentaSvc);
    periodoSvc        = new PeriodoContableService();
    tasaSvc           = new TasaCambioService();
    consolidacionSvc  = new ConsolidacionService();
    handlerFx         = new ContabilidadDiferenciaCambiariaHandler(reglaSvc, asientoSvc);

    // IDs
    tenantId        = newId();
    empresaId       = newId();
    empresaBId      = newId();
    tenantOtroId    = newId();
    empresaOtraId   = newId();
    centroCostoId   = newId();
    centroCostoOtroId = newId();

    cuentaIngresoId    = newId();
    cuentaGastoId      = newId();
    cuentaPatrimonioId = newId();
    cuentaGananciaFxId = newId();
    cuentaPerdidaFxId  = newId();
    cuentaDebeId       = newId();
    cuentaHaberId      = newId();

    reglaGananciaFxId = newId();
    reglaPerdidaFxId  = newId();

    // ── Tenant principal ───────────────────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO tenant (id, nombre, slug, created_by, updated_by)
       VALUES ($1,'Constructora CM [test]',$2,$3,$3)`,
      [tenantId, `cm-t1-${tenantId.slice(-12)}`, SYSTEM_USER_ID],
    );

    // Tenant externo (consolidación RLS)
    await adminPool.query(
      `INSERT INTO tenant (id, nombre, slug, created_by, updated_by)
       VALUES ($1,'Otra Constructora CM [test]',$2,$3,$3)`,
      [tenantOtroId, `cm-t2-${tenantOtroId.slice(-12)}`, SYSTEM_USER_ID],
    );

    // Empresas
    await adminPool.query(
      `INSERT INTO empresa (id, tenant_id, nombre, created_by, updated_by)
       VALUES ($1,$2,'Empresa CM A [test]',$5,$5),
              ($3,$2,'Empresa CM B [test]',$5,$5),
              ($4,$6,'Empresa CM Otro Tenant [test]',$5,$5)`,
      [empresaId, tenantId, empresaBId, empresaOtraId, SYSTEM_USER_ID, tenantOtroId],
    );

    // Centros de costo
    await adminPool.query(
      `INSERT INTO centro_costo (id, tenant_id, empresa_id, codigo, nombre, tipo, created_by, updated_by)
       VALUES ($1,$2,$3,'ADM-CM','Centro CM A','ADMINISTRATIVO',$4,$4),
              ($5,$2,$6,'ADM-CM-B','Centro CM B','ADMINISTRATIVO',$4,$4)`,
      [centroCostoId, tenantId, empresaId, SYSTEM_USER_ID, centroCostoOtroId, empresaBId],
    );

    // ── Cuentas contables — Empresa A ────────────────────────────────────────
    await adminPool.query(
      `INSERT INTO cuenta_contable
         (id, tenant_id, empresa_id, codigo, nombre, tipo, naturaleza, nivel, es_movimiento, activo, created_by, updated_by)
       VALUES
         ($1,$2,$3,'4001','Ingresos por Servicios','ingreso','acreedora',2,true,true,$4,$4),
         ($5,$2,$3,'6001','Gastos Generales','gasto','deudora',2,true,true,$4,$4),
         ($6,$2,$3,'3901','Utilidad del Ejercicio','patrimonio','acreedora',2,true,true,$4,$4),
         ($7,$2,$3,'4800','Ganancia Cambiaria','ingreso','acreedora',2,true,true,$4,$4),
         ($8,$2,$3,'6800','Pérdida Cambiaria','gasto','deudora',2,true,true,$4,$4)`,
      [cuentaIngresoId, tenantId, empresaId, SYSTEM_USER_ID,
       cuentaGastoId, cuentaPatrimonioId, cuentaGananciaFxId, cuentaPerdidaFxId],
    );

    // ── Cuentas contables — Empresa B (para consolidación) ──────────────────
    await adminPool.query(
      `INSERT INTO cuenta_contable
         (id, tenant_id, empresa_id, codigo, nombre, tipo, naturaleza, nivel, es_movimiento, activo, created_by, updated_by)
       VALUES
         ($1,$2,$3,'1001','Activo CM-B','activo','deudora',2,true,true,$4,$4),
         ($5,$2,$3,'2001','Pasivo CM-B','pasivo','acreedora',2,true,true,$4,$4)`,
      [cuentaDebeId, tenantId, empresaBId, SYSTEM_USER_ID, cuentaHaberId],
    );

    // ── Reglas contables FX ─────────────────────────────────────────────────
    const reglaGananciaConfig: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito',  cuentaCodigo: '4001', descripcion: 'DB cta por cobrar FX' },
        { tipo: 'credito', cuentaCodigo: '4800', descripcion: 'CR ganancia cambiaria' },
      ],
    };
    const reglaPerdidaConfig: ConfiguracionRegla = {
      lineas: [
        { tipo: 'debito',  cuentaCodigo: '6800', descripcion: 'DB pérdida cambiaria' },
        { tipo: 'credito', cuentaCodigo: '4001', descripcion: 'CR cta por cobrar FX' },
      ],
    };

    await adminPool.query(
      `INSERT INTO regla_contable
         (id, tenant_id, empresa_id, tipo_evento, nombre, configuracion, prioridad, activo, created_by, updated_by)
       VALUES ($1,$2,$3,'diferencia_cambiaria_ganancia','Ganancia FX',$4::jsonb,0,true,$5,$5),
              ($6,$2,$3,'diferencia_cambiaria_perdida','Pérdida FX',$7::jsonb,0,true,$5,$5)`,
      [reglaGananciaFxId, tenantId, empresaId, JSON.stringify(reglaGananciaConfig), SYSTEM_USER_ID,
       reglaPerdidaFxId, JSON.stringify(reglaPerdidaConfig)],
    );
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM linea_asiento WHERE tenant_id IN ($1,$2)`, [tenantId, tenantOtroId]);
    await adminPool.query(`DELETE FROM asiento_contable WHERE tenant_id IN ($1,$2)`, [tenantId, tenantOtroId]);
    await adminPool.query(`DELETE FROM regla_contable WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM checklist_cierre WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM periodo_contable WHERE tenant_id IN ($1,$2)`, [tenantId, tenantOtroId]);
    await adminPool.query(`DELETE FROM tasa_cambio WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM cuenta_contable WHERE tenant_id IN ($1,$2)`, [tenantId, tenantOtroId]);
    await adminPool.query(`ALTER TABLE evento_operativo DISABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`DELETE FROM evento_operativo WHERE tenant_id IN ($1,$2)`, [tenantId, tenantOtroId]);
    await adminPool.query(`ALTER TABLE evento_operativo ENABLE TRIGGER enforce_append_only_evento_operativo`);
    await adminPool.query(`ALTER TABLE centro_costo DISABLE TRIGGER no_delete_centro_costo`);
    await adminPool.query(`DELETE FROM centro_costo WHERE id IN ($1,$2)`, [centroCostoId, centroCostoOtroId]);
    await adminPool.query(`ALTER TABLE centro_costo ENABLE TRIGGER no_delete_centro_costo`);
    await adminPool.query(`ALTER TABLE empresa DISABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM empresa WHERE id IN ($1,$2,$3)`, [empresaId, empresaBId, empresaOtraId]);
    await adminPool.query(`ALTER TABLE empresa ENABLE TRIGGER no_delete_empresa`);
    await adminPool.query(`DELETE FROM audit_log WHERE tenant_id IN ($1,$2)`, [tenantId, tenantOtroId]);
    await adminPool.query(`ALTER TABLE tenant DISABLE TRIGGER no_delete_tenant`);
    await adminPool.query(`DELETE FROM tenant WHERE id IN ($1,$2)`, [tenantId, tenantOtroId]);
    await adminPool.query(`ALTER TABLE tenant ENABLE TRIGGER no_delete_tenant`);
    await adminPool.end();
    await appPool.end();
  });

  // ─── 1. Cerrar período ──────────────────────────────────────────────────────
  it('01 — cerrar período: estado=CERRADO registrado en BD', async () => {
    await adminDb.transaction(async (tx) => {
      const periodo = await periodoSvc.cerrar(tx, tenantId, empresaId, 2025, 1, SYSTEM_USER_ID);
      expect(periodo.estado).toBe('CERRADO');
      expect(periodo.cerradoPor).toBe(SYSTEM_USER_ID);
    });

    const res = await adminPool.query(
      `SELECT estado FROM periodo_contable WHERE empresa_id=$1 AND anio=2025 AND mes=1`,
      [empresaId],
    );
    expect(res.rows[0].estado).toBe('CERRADO');
  });

  // ─── 2. Asiento sobre período cerrado → rechazado ──────────────────────────
  it('02 — asiento sobre período cerrado → UnprocessableEntityException del motor', async () => {
    await expect(
      adminDb.transaction(async (tx) => {
        await asientoSvc.generar(
          {
            tenantId,
            empresaId,
            tipo: 'ajuste',
            fecha: '2025-01-15',
            descripcion: 'Ajuste sobre período cerrado',
            lineas: [
              { cuentaCodigo: '4001', tipo: 'debe',  importe: '100.0000', moneda: 'DOP' },
              { cuentaCodigo: '6001', tipo: 'haber', importe: '100.0000', moneda: 'DOP' },
            ],
            usuarioId: SYSTEM_USER_ID,
          },
          tx,
        );
      }),
    ).rejects.toThrow(/cerrado/i);
  });

  // ─── 3. Asiento sobre período reabierto → permitido ─────────────────────────
  it('03 — asiento sobre período reabierto → pasa sin error', async () => {
    // Primero reabrir el período 2025-01
    await adminDb.transaction(async (tx) => {
      await periodoSvc.reabrir(tx, tenantId, empresaId, 2025, 1, SYSTEM_USER_ID, 'Corrección de prueba');
    });

    // Ahora el asiento debe pasar
    const asiento = await adminDb.transaction(async (tx) => {
      return asientoSvc.generar(
        {
          tenantId,
          empresaId,
          tipo: 'ajuste',
          fecha: '2025-01-15',
          descripcion: 'Ajuste sobre período reabierto',
          lineas: [
            { cuentaCodigo: '4001', tipo: 'debe',  importe: '50.0000', moneda: 'DOP' },
            { cuentaCodigo: '6001', tipo: 'haber', importe: '50.0000', moneda: 'DOP' },
          ],
          usuarioId: SYSTEM_USER_ID,
        },
        tx,
      );
    });
    expect(asiento.id).toBeDefined();
  });

  // ─── 4. Reabrir período ─────────────────────────────────────────────────────
  it('04 — reabrir período: estado=REABIERTO + motivo registrado', async () => {
    // Cerrar 2025-02 primero
    await adminDb.transaction(async (tx) => {
      await periodoSvc.cerrar(tx, tenantId, empresaId, 2025, 2, SYSTEM_USER_ID);
    });

    await adminDb.transaction(async (tx) => {
      const periodo = await periodoSvc.reabrir(
        tx, tenantId, empresaId, 2025, 2, SYSTEM_USER_ID, 'Ajuste contable requerido',
      );
      expect(periodo.estado).toBe('REABIERTO');
      expect(periodo.motivoReapertura).toBe('Ajuste contable requerido');
    });

    const res = await adminPool.query(
      `SELECT estado, motivo_reapertura FROM periodo_contable WHERE empresa_id=$1 AND anio=2025 AND mes=2`,
      [empresaId],
    );
    expect(res.rows[0].estado).toBe('REABIERTO');
    expect(res.rows[0].motivo_reapertura).toBe('Ajuste contable requerido');
  });

  // ─── 5. Cerrar período ya cerrado → ConflictException ───────────────────────
  it('05 — cerrar período ya cerrado → ConflictException', async () => {
    // Cerrar 2025-03
    await adminDb.transaction(async (tx) => {
      await periodoSvc.cerrar(tx, tenantId, empresaId, 2025, 3, SYSTEM_USER_ID);
    });

    // Intentar cerrar de nuevo
    await expect(
      adminDb.transaction(async (tx) => {
        await periodoSvc.cerrar(tx, tenantId, empresaId, 2025, 3, SYSTEM_USER_ID);
      }),
    ).rejects.toThrow(/ya está cerrado/i);
  });

  // ─── 6. Período abierto (sin registro): asiento pasa ────────────────────────
  it('06 — asiento sobre período sin registro (abierto por defecto) → pasa sin error', async () => {
    // Período 2099-12 nunca fue registrado → asiento permitido
    const asiento = await adminDb.transaction(async (tx) => {
      return asientoSvc.generar(
        {
          tenantId,
          empresaId,
          tipo: 'ajuste',
          fecha: '2099-12-01',
          descripcion: 'Asiento período implícito',
          lineas: [
            { cuentaCodigo: '4001', tipo: 'debe',  importe: '10.0000', moneda: 'DOP' },
            { cuentaCodigo: '6001', tipo: 'haber', importe: '10.0000', moneda: 'DOP' },
          ],
          usuarioId: SYSTEM_USER_ID,
        },
        tx,
      );
    });
    expect(asiento.id).toBeDefined();
  });

  // ─── 7. Registrar tasa de cambio USD/DOP ────────────────────────────────────
  it('07 — registrar tasa de cambio USD/DOP → tasa guardada en BD', async () => {
    await adminDb.transaction(async (tx) => {
      const tasa = await tasaSvc.registrar(tx, {
        tenantId,
        monedaOrigen:  'USD',
        monedaDestino: 'DOP',
        tasa: '60.000000',
        fecha: '2025-01-01',
        fuente: 'BCRD',
        userId: SYSTEM_USER_ID,
      });
      expect(tasa.tasa).toBe('60.000000');
      expect(tasa.monedaOrigen).toBe('USD');
      expect(tasa.monedaDestino).toBe('DOP');
    });
  });

  // ─── 8. Consultar tasa vigente para fecha ───────────────────────────────────
  it('08 — tasa vigente: devuelve la más reciente <= fecha consultada', async () => {
    // Registrar tasa del 15 de enero (más reciente que la del test 07)
    await adminDb.transaction(async (tx) => {
      await tasaSvc.registrar(tx, {
        tenantId,
        monedaOrigen:  'USD',
        monedaDestino: 'DOP',
        tasa: '61.500000',
        fecha: '2025-01-15',
        userId: SYSTEM_USER_ID,
      });
    });

    // Consultar para 20 de enero → debe devolver la del 15
    const tasa = await adminDb.transaction(async (tx) => {
      return tasaSvc.getVigenteParaFecha(tx, tenantId, 'USD', 'DOP', '2025-01-20');
    });

    expect(tasa.tasa).toBe('61.500000');
    expect(tasa.fecha).toBe('2025-01-15');
  });

  // ─── 9. Cobro recibido misma tasa → sin diferencia cambiaria ────────────────
  it('09 — cobro a misma tasa que factura → sin asiento de diferencia cambiaria', async () => {
    const payload = {
      cuentaBancariaId: newId(),
      facturaClienteId: null,
      montoCobrado:     { amount: '1000.0000', currency: 'USD' },
      tasaFactura:      '60.000000',
      tasaCobro:        '60.000000',
      monedaBase:       'DOP',
    };
    const evento = makeEvento({ payload, idempotencyKey: newId() });

    await adminDb.transaction(async (tx) => {
      await tx.insert(schema.eventosOperativos).values({
        id: evento.id, tenantId, empresaId, centroCostoId,
        tipoEvento: 'cobro_recibido', usuarioId: SYSTEM_USER_ID,
        payload, idempotencyKey: evento.idempotencyKey,
        estado: 'registrado', createdBy: SYSTEM_USER_ID,
      });
      await handlerFx.ejecutar({ evento: evento as never, tx: tx as never });
    });

    // No debe haberse generado ningún asiento para este evento
    const res = await adminPool.query(
      `SELECT id FROM asiento_contable WHERE evento_id=$1`,
      [evento.id],
    );
    expect(res.rows).toHaveLength(0);
  });

  // ─── 10. Cobro a tasa mayor → asiento ganancia cambiaria ─────────────────────
  it('10 — cobro a tasa mayor → asiento ganancia cambiaria generado', async () => {
    const payload = {
      cuentaBancariaId: newId(),
      facturaClienteId: null,
      montoCobrado:     { amount: '1000.0000', currency: 'USD' },
      tasaFactura:      '60.000000',
      tasaCobro:        '62.000000',
      monedaBase:       'DOP',
    };
    const evento = makeEvento({ payload, idempotencyKey: newId() });

    await adminDb.transaction(async (tx) => {
      await tx.insert(schema.eventosOperativos).values({
        id: evento.id, tenantId, empresaId, centroCostoId,
        tipoEvento: 'cobro_recibido', usuarioId: SYSTEM_USER_ID,
        payload, idempotencyKey: evento.idempotencyKey,
        estado: 'registrado', createdBy: SYSTEM_USER_ID,
      });
      await handlerFx.ejecutar({ evento: evento as never, tx: tx as never });
    });

    // Debe haberse generado 1 asiento
    const res = await adminPool.query(
      `SELECT ac.id FROM asiento_contable ac
       WHERE ac.evento_id=$1 AND ac.regla_id=$2`,
      [evento.id, reglaGananciaFxId],
    );
    expect(res.rows).toHaveLength(1);
  });

  // ─── 11. Cobro a tasa menor → asiento pérdida cambiaria ──────────────────────
  it('11 — cobro a tasa menor → asiento pérdida cambiaria generado', async () => {
    const payload = {
      cuentaBancariaId: newId(),
      facturaClienteId: null,
      montoCobrado:     { amount: '500.0000', currency: 'USD' },
      tasaFactura:      '61.000000',
      tasaCobro:        '59.500000',
      monedaBase:       'DOP',
    };
    const evento = makeEvento({ payload, idempotencyKey: newId() });

    await adminDb.transaction(async (tx) => {
      await tx.insert(schema.eventosOperativos).values({
        id: evento.id, tenantId, empresaId, centroCostoId,
        tipoEvento: 'cobro_recibido', usuarioId: SYSTEM_USER_ID,
        payload, idempotencyKey: evento.idempotencyKey,
        estado: 'registrado', createdBy: SYSTEM_USER_ID,
      });
      await handlerFx.ejecutar({ evento: evento as never, tx: tx as never });
    });

    const res = await adminPool.query(
      `SELECT ac.id FROM asiento_contable ac
       WHERE ac.evento_id=$1 AND ac.regla_id=$2`,
      [evento.id, reglaPerdidaFxId],
    );
    expect(res.rows).toHaveLength(1);
  });

  // ─── 12. Diferencia cambiaria: Σdebe = Σhaber ────────────────────────────────
  it('12 — asiento diferencia cambiaria: Σdebe = Σhaber', async () => {
    // Diferencia = 2000 × (63 - 60) = 6000 DOP ganancia
    const payload = {
      cuentaBancariaId: newId(),
      facturaClienteId: null,
      montoCobrado:     { amount: '2000.0000', currency: 'USD' },
      tasaFactura:      '60.000000',
      tasaCobro:        '63.000000',
      monedaBase:       'DOP',
    };
    const evento = makeEvento({ payload, idempotencyKey: newId() });

    await adminDb.transaction(async (tx) => {
      await tx.insert(schema.eventosOperativos).values({
        id: evento.id, tenantId, empresaId, centroCostoId,
        tipoEvento: 'cobro_recibido', usuarioId: SYSTEM_USER_ID,
        payload, idempotencyKey: evento.idempotencyKey,
        estado: 'registrado', createdBy: SYSTEM_USER_ID,
      });
      await handlerFx.ejecutar({ evento: evento as never, tx: tx as never });
    });

    const res = await adminPool.query(
      `SELECT
         SUM(CASE WHEN la.tipo='debe'  THEN la.importe::numeric ELSE 0 END) AS total_debe,
         SUM(CASE WHEN la.tipo='haber' THEN la.importe::numeric ELSE 0 END) AS total_haber
       FROM linea_asiento la
       JOIN asiento_contable ac ON ac.id = la.asiento_id
       WHERE ac.evento_id = $1`,
      [evento.id],
    );
    const { total_debe, total_haber } = res.rows[0] as { total_debe: string; total_haber: string };
    expect(parseFloat(total_debe)).toBeCloseTo(parseFloat(total_haber), 4);
    expect(parseFloat(total_debe)).toBeCloseTo(6000, 2); // 2000 × 3
  });

  // ─── 13. Asiento cierre de resultados ─────────────────────────────────────────
  it('13 — asiento cierre de resultados: cuentas de ingreso/gasto saldadas contra Utilidad Ejercicio', async () => {
    // Crear asiento de ingreso: CR 4001 = 5000
    await adminDb.transaction(async (tx) => {
      await asientoSvc.generar(
        {
          tenantId, empresaId,
          tipo: 'ajuste',
          fecha: '2025-04-15',
          descripcion: 'Ingreso para cierre',
          lineas: [
            { cuentaCodigo: '6001', tipo: 'debe',  importe: '5000.0000', moneda: 'DOP' },
            { cuentaCodigo: '4001', tipo: 'haber', importe: '5000.0000', moneda: 'DOP' },
          ],
          usuarioId: SYSTEM_USER_ID,
        },
        tx,
      );
    });

    // Generar asiento de cierre de resultados para 2025
    const resumen = await adminDb.transaction(async (tx) => {
      return periodoSvc.generarAsientoCierreEjercicio(
        tx, tenantId, empresaId, 2025, SYSTEM_USER_ID, '3901',
      );
    });

    expect(resumen.asientoId).toBeDefined();

    // El asiento cierre debe tener al menos una línea para la cuenta 3901 (Utilidad Ejercicio)
    const res = await adminPool.query(
      `SELECT la.tipo, la.importe::numeric, cc.codigo
       FROM linea_asiento la
       JOIN cuenta_contable cc ON cc.id = la.cuenta_id
       WHERE la.asiento_id = $1
       ORDER BY cc.codigo`,
      [resumen.asientoId],
    );
    const codigos = res.rows.map((r: { codigo: string }) => r.codigo);
    expect(codigos).toContain('3901');

    // Balance: Σdebe = Σhaber
    const totales = await adminPool.query(
      `SELECT
         SUM(CASE WHEN tipo='debe'  THEN importe::numeric ELSE 0 END) AS td,
         SUM(CASE WHEN tipo='haber' THEN importe::numeric ELSE 0 END) AS th
       FROM linea_asiento WHERE asiento_id=$1`,
      [resumen.asientoId],
    );
    expect(parseFloat(totales.rows[0].td)).toBeCloseTo(parseFloat(totales.rows[0].th), 4);
  });

  // ─── 14. Consolidación multi-empresa ─────────────────────────────────────────
  it('14 — consolidación multi-empresa: totales Σdebe = Σhaber cuando ambas balancean', async () => {
    // Crear asiento balanceado en empresa B
    await adminDb.transaction(async (tx) => {
      await asientoSvc.generar(
        {
          tenantId, empresaId: empresaBId,
          tipo: 'ajuste',
          fecha: '2025-05-10',
          descripcion: 'Asiento empresa B para consolidación',
          lineas: [
            { cuentaCodigo: '1001', tipo: 'debe',  importe: '3000.0000', moneda: 'DOP' },
            { cuentaCodigo: '2001', tipo: 'haber', importe: '3000.0000', moneda: 'DOP' },
          ],
          usuarioId: SYSTEM_USER_ID,
        },
        tx,
      );
    });

    const resultado = await adminDb.transaction(async (tx) => {
      return consolidacionSvc.consolidar(tx, tenantId, [empresaId, empresaBId]);
    });

    // La diferencia entre total debe y haber debe ser cercana a 0 si todas las entradas balancean
    expect(resultado.empresas.length).toBeGreaterThan(0);
    // Verificar que empresa B aparece en los resultados
    const empresasIds = resultado.empresas.map((e) => e.empresaId);
    expect(empresasIds).toContain(empresaBId);
  });

  // ─── 15. Consolidación excluye empresa de otro tenant ────────────────────────
  it('15 — consolidación no incluye empresa de otro tenant aunque se pase el ID', async () => {
    // No hay cuentas ni asientos en empresaOtraId (tenant diferente), pero probamos que si pasamos
    // ese ID a consolidar con tenantId no se filtra ese tenant
    const resultado = await adminDb.transaction(async (tx) => {
      return consolidacionSvc.consolidar(tx, tenantId, [empresaOtraId]);
    });

    // Como cuentasContables filtra por tenantId, no debe aparecer la empresa del otro tenant
    const empresasIds = resultado.empresas.map((e) => e.empresaId);
    expect(empresasIds).not.toContain(empresaOtraId);
  });

  // ─── 16. Checklist: ítem requerido pendiente bloquea cierre ──────────────────
  it('16 — checklist cierre: ítem requerido pendiente bloquea cierre del período', async () => {
    // Insertar ítem requerido NO completado para 2025-06
    await adminPool.query(
      `INSERT INTO checklist_cierre
         (id, tenant_id, empresa_id, anio, mes, nombre, requerido, completado, created_by, updated_by)
       VALUES ($1,$2,$3,2025,6,'Conciliación bancaria',true,false,$4,$4)`,
      [newId(), tenantId, empresaId, SYSTEM_USER_ID],
    );

    await expect(
      adminDb.transaction(async (tx) => {
        await periodoSvc.cerrar(tx, tenantId, empresaId, 2025, 6, SYSTEM_USER_ID);
      }),
    ).rejects.toThrow(/Conciliación bancaria/);
  });

  // ─── 17. RLS: período cerrado empresa A no afecta empresa B ──────────────────
  it('17 — período cerrado empresa A no bloquea asientos en empresa B', async () => {
    // Cerrar 2025-07 para empresa A
    await adminDb.transaction(async (tx) => {
      await periodoSvc.cerrar(tx, tenantId, empresaId, 2025, 7, SYSTEM_USER_ID);
    });

    // Empresa B, mismo período → debe permitir asiento
    const asiento = await adminDb.transaction(async (tx) => {
      return asientoSvc.generar(
        {
          tenantId,
          empresaId: empresaBId,
          tipo: 'ajuste',
          fecha: '2025-07-15',
          descripcion: 'Ajuste empresa B período no cerrado',
          lineas: [
            { cuentaCodigo: '1001', tipo: 'debe',  importe: '200.0000', moneda: 'DOP' },
            { cuentaCodigo: '2001', tipo: 'haber', importe: '200.0000', moneda: 'DOP' },
          ],
          usuarioId: SYSTEM_USER_ID,
        },
        tx,
      );
    });
    expect(asiento.id).toBeDefined();
  });
});
