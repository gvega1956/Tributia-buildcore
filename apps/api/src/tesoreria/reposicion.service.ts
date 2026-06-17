import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import { DbService } from '../database/db.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { reposicionesCajaChica } from '../db/schema/tesoreria/reposicion_caja_chica.js';
import { fondosCajaChica } from '../db/schema/tesoreria/fondo_caja_chica.js';

export interface SolicitarReposicionInput {
  fondoId: string;
  monto: string;
  moneda?: string | undefined;
}

@Injectable()
export class ReposicionCajaChicaService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly workflow: WorkflowService,
  ) {}

  async solicitar(tenantId: string, usuarioId: string, input: SolicitarReposicionInput) {
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

    if (!fondo) throw new NotFoundException(`Fondo ${input.fondoId} no encontrado.`);
    if (fondo.estado !== 'ACTIVO') {
      throw new ConflictException(`El fondo ${input.fondoId} no está activo.`);
    }

    const instancia = await this.workflow.iniciarFlujo(tenantId, usuarioId, {
      tipoDocumento: 'reposicion_caja_chica',
      documentoId: input.fondoId,
      documentoTabla: 'reposicion_caja_chica',
      descripcion: `Reposición caja chica fondo ${input.fondoId.slice(0, 8)} — ${input.monto}`,
      monto: new Decimal(input.monto).toFixed(4),
      moneda: (input.moneda ?? fondo.moneda) as 'DOP' | 'USD' | 'EUR',
      metadata: null,
    });

    const now = new Date();
    const [reposicion] = await this.db.tx
      .insert(reposicionesCajaChica)
      .values({
        id: newId(),
        tenantId,
        fondoId: input.fondoId,
        montoSolicitado: new Decimal(input.monto).toFixed(4),
        moneda: input.moneda ?? fondo.moneda,
        instanciaFlujoId: instancia.id,
        estado: 'SOLICITADA',
        eventoOrigenId: null,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .returning();

    return { reposicion: reposicion!, instanciaFlujoId: instancia.id };
  }

  /**
   * Ejecuta la reposición SOLO si la instancia de workflow está APROBADO.
   * Re-lee el estado desde la BD para no depender del caché del llamador.
   */
  async ejecutar(tenantId: string, usuarioId: string, reposicionId: string) {
    const [rep] = await this.db.tx
      .select()
      .from(reposicionesCajaChica)
      .where(
        and(
          eq(reposicionesCajaChica.id, reposicionId),
          eq(reposicionesCajaChica.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!rep) throw new NotFoundException(`Reposición ${reposicionId} no encontrada.`);

    if (rep.estado !== 'SOLICITADA') {
      throw new ConflictException(
        `La reposición ya está en estado ${rep.estado} y no puede ejecutarse.`,
      );
    }

    if (!rep.instanciaFlujoId) {
      throw new ConflictException(`La reposición ${reposicionId} no tiene instancia de flujo asociada.`);
    }

    const instancia = await this.workflow.findInstanciaById(rep.instanciaFlujoId);

    if (instancia.estado !== 'APROBADO') {
      throw new ConflictException(
        `La reposición requiere aprobación. Estado actual del flujo: ${instancia.estado}.`,
      );
    }

    const [fondo] = await this.db.tx
      .select()
      .from(fondosCajaChica)
      .where(eq(fondosCajaChica.id, rep.fondoId))
      .limit(1);

    if (!fondo) throw new NotFoundException(`Fondo ${rep.fondoId} no encontrado.`);

    const evento = await this.ledger.append({
      tenantId,
      empresaId: fondo.empresaId,
      proyectoId: fondo.proyectoId,
      centroCostoId: null,
      tipoEvento: 'reposicion_caja_chica',
      usuarioId,
      payload: {
        fondoId: rep.fondoId,
        reposicionId: rep.id,
        cuentaBancariaOrigenId: fondo.cuentaBancariaOrigenId,
        monto: { amount: rep.montoSolicitado, currency: rep.moneda },
        instanciaFlujoId: rep.instanciaFlujoId,
      },
      referenciaId: rep.id,
      referenciaTabla: 'reposicion_caja_chica',
      idempotencyKey: newId(),
    });

    const now = new Date();
    const nuevoSaldo = new Decimal(fondo.saldoDisponible)
      .plus(new Decimal(rep.montoSolicitado))
      .toFixed(4);

    await this.db.tx
      .update(fondosCajaChica)
      .set({ saldoDisponible: nuevoSaldo, updatedAt: now, updatedBy: usuarioId })
      .where(eq(fondosCajaChica.id, rep.fondoId));

    await this.db.tx
      .update(reposicionesCajaChica)
      .set({ estado: 'EJECUTADA', eventoOrigenId: evento.id, updatedAt: now, updatedBy: usuarioId })
      .where(eq(reposicionesCajaChica.id, reposicionId));

    return { eventoId: evento.id, saldoDisponible: nuevoSaldo };
  }
}
