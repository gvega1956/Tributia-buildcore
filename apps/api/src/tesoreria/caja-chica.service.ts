import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { fondosCajaChica } from '../db/schema/tesoreria/fondo_caja_chica.js';
import { gastosCajaChica } from '../db/schema/tesoreria/gasto_caja_chica.js';

export interface CrearFondoInput {
  empresaId: string;
  proyectoId: string;
  responsableId: string;
  cuentaBancariaOrigenId: string;
  montoAsignado: string;
  moneda?: string | undefined;
}

export interface RegistrarGastoInput {
  fondoId: string;
  empresaId: string;
  proyectoId: string;
  fecha: string;
  monto: string;
  moneda?: string | undefined;
  concepto: string;
  numeroComprobante: string;
  tipoComprobante: 'FACTURA' | 'RECIBO' | 'NCF' | 'OTRO';
  proveedorTerceroId?: string | undefined;
  partidaId?: string | undefined;
}

@Injectable()
export class CajaChicaService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  async crearFondo(tenantId: string, usuarioId: string, input: CrearFondoInput) {
    const now = new Date();
    const [fondo] = await this.db.tx
      .insert(fondosCajaChica)
      .values({
        id: newId(),
        tenantId,
        empresaId: input.empresaId,
        proyectoId: input.proyectoId,
        responsableId: input.responsableId,
        cuentaBancariaOrigenId: input.cuentaBancariaOrigenId,
        montoAsignado: new Decimal(input.montoAsignado).toFixed(4),
        saldoDisponible: new Decimal(input.montoAsignado).toFixed(4),
        moneda: input.moneda ?? 'DOP',
        estado: 'ACTIVO',
        activo: true,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();

    return fondo!;
  }

  async registrarGasto(tenantId: string, usuarioId: string, input: RegistrarGastoInput) {
    const [fondo] = await this.db.tx
      .select()
      .from(fondosCajaChica)
      .where(
        and(
          eq(fondosCajaChica.id, input.fondoId),
          eq(fondosCajaChica.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!fondo) throw new NotFoundException(`Fondo de caja chica ${input.fondoId} no encontrado.`);
    if (fondo.estado !== 'ACTIVO') {
      throw new BadRequestException(`El fondo ${input.fondoId} no está activo.`);
    }

    const montoGasto = new Decimal(input.monto);
    const saldoActual = new Decimal(fondo.saldoDisponible);

    if (montoGasto.gt(saldoActual)) {
      throw new BadRequestException(
        `El gasto ${input.monto} excede el saldo disponible del fondo (${saldoActual.toFixed(4)}).`,
      );
    }

    const moneda = input.moneda ?? fondo.moneda;

    const evento = await this.ledger.append({
      tenantId,
      empresaId: input.empresaId,
      proyectoId: input.proyectoId,
      centroCostoId: null,
      tipoEvento: 'gasto_caja_chica',
      usuarioId,
      payload: {
        fondoId: input.fondoId,
        monto: { amount: montoGasto.toFixed(4), currency: moneda },
        concepto: input.concepto,
        numeroComprobante: input.numeroComprobante,
        tipoComprobante: input.tipoComprobante,
        proveedorTerceroId: input.proveedorTerceroId ?? null,
        partidaId: input.partidaId ?? null,
      },
      referenciaId: input.fondoId,
      referenciaTabla: 'fondo_caja_chica',
      idempotencyKey: newId(),
    });

    const now = new Date();
    const nuevoSaldo = saldoActual.minus(montoGasto).toFixed(4);

    await this.db.tx
      .update(fondosCajaChica)
      .set({ saldoDisponible: nuevoSaldo, updatedAt: now, updatedBy: usuarioId })
      .where(eq(fondosCajaChica.id, input.fondoId));

    await this.db.tx.insert(gastosCajaChica).values({
      id: newId(),
      tenantId,
      fondoId: input.fondoId,
      fecha: input.fecha,
      monto: montoGasto.toFixed(4),
      moneda,
      concepto: input.concepto,
      numeroComprobante: input.numeroComprobante,
      tipoComprobante: input.tipoComprobante,
      proveedorTerceroId: input.proveedorTerceroId ?? null,
      partidaId: input.partidaId ?? null,
      eventoOrigenId: evento.id,
      asientoId: null,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    });

    return { eventoId: evento.id, saldoDisponible: nuevoSaldo };
  }
}
