import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { cuentasBancarias } from '../db/schema/tesoreria/cuenta_bancaria.js';
import { movimientosBancarios } from '../db/schema/tesoreria/movimiento_bancario.js';

export interface CrearCuentaBancariaInput {
  empresaId: string;
  bancoNombre: string;
  numeroCuenta: string;
  tipoCuenta?: 'CORRIENTE' | 'AHORROS' | undefined;
  moneda?: string | undefined;
  cuentaContableCodigo: string;
}

@Injectable()
export class BancoService {
  constructor(private readonly db: DbService) {}

  async crearCuenta(tenantId: string, usuarioId: string, input: CrearCuentaBancariaInput) {
    const existing = await this.db.tx
      .select({ id: cuentasBancarias.id })
      .from(cuentasBancarias)
      .where(
        and(
          eq(cuentasBancarias.tenantId, tenantId),
          eq(cuentasBancarias.numeroCuenta, input.numeroCuenta),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(
        `Ya existe una cuenta bancaria con número ${input.numeroCuenta} en este tenant.`,
      );
    }

    const now = new Date();
    const [cuenta] = await this.db.tx
      .insert(cuentasBancarias)
      .values({
        id: newId(),
        tenantId,
        empresaId: input.empresaId,
        bancoNombre: input.bancoNombre,
        numeroCuenta: input.numeroCuenta,
        tipoCuenta: input.tipoCuenta ?? 'CORRIENTE',
        moneda: input.moneda ?? 'DOP',
        cuentaContableCodigo: input.cuentaContableCodigo,
        saldoActual: '0.0000',
        activo: true,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();

    return cuenta!;
  }

  async listarCuentas(tenantId: string, empresaId?: string) {
    const conditions = [eq(cuentasBancarias.tenantId, tenantId)];
    if (empresaId) conditions.push(eq(cuentasBancarias.empresaId, empresaId));
    return this.db.tx.select().from(cuentasBancarias).where(and(...conditions));
  }

  async findCuentaById(tenantId: string, id: string) {
    const [c] = await this.db.tx
      .select()
      .from(cuentasBancarias)
      .where(and(eq(cuentasBancarias.id, id), eq(cuentasBancarias.tenantId, tenantId)))
      .limit(1);
    if (!c) throw new NotFoundException(`Cuenta bancaria ${id} no encontrada.`);
    return c;
  }

  async listarMovimientos(tenantId: string, cuentaBancariaId: string) {
    return this.db.tx
      .select()
      .from(movimientosBancarios)
      .where(
        and(
          eq(movimientosBancarios.tenantId, tenantId),
          eq(movimientosBancarios.cuentaBancariaId, cuentaBancariaId),
        ),
      );
  }
}
