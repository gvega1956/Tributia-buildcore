import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { eq, and, isNull } from 'drizzle-orm';
import { newId } from '@tributia/shared';
import type { RequisicionCreateInput } from '@tributia/compras';
import { DbService } from '../database/db.service.js';
import { DisponibilidadService } from './disponibilidad.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { requisiciones, lineasRequisicion } from '../db/schema/compras/requisicion.js';

@Injectable()
export class RequisicionService {
  private readonly logger = new Logger(RequisicionService.name);

  constructor(
    private readonly db: DbService,
    private readonly disponibilidadSvc: DisponibilidadService,
    private readonly workflowSvc: WorkflowService,
  ) {}

  async create(tenantId: string, usuarioId: string, input: RequisicionCreateInput) {
    const now = new Date();
    const numero = `REQ-${Date.now()}`;

    try {
      const [req] = await this.db.tx
        .insert(requisiciones)
        .values({
          id: newId(),
          tenantId,
          empresaId: input.empresaId,
          proyectoId: input.proyectoId,
          numero,
          estado: 'BORRADOR',
          solicitadoPor: usuarioId,
          fechaRequerida: input.fechaRequerida ?? null,
          notas: input.notas ?? null,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        })
        .returning();

      // Insertar líneas
      for (const linea of input.lineas) {
        await this.db.tx.insert(lineasRequisicion).values({
          id: newId(),
          tenantId,
          requisicionId: req!.id,
          partidaId: linea.partidaId,
          insumoId: linea.insumoId ?? null,
          descripcion: linea.descripcion,
          cantidad: linea.cantidad,
          unidadMedida: linea.unidadMedida,
          precioEstimado: linea.precioEstimado ?? '0.0000',
          moneda: linea.moneda,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        });
      }

      return req!;
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('Conflicto al crear la requisición.');
      }
      throw err;
    }
  }

  /**
   * Submite una requisición para aprobación.
   * Valida disponible = presupuestado − comprometido − devengado por cada partida.
   * Si alguna línea excede el disponible → PENDIENTE_APROBACION + workflow excepcional.
   * Si todas están dentro del disponible → APROBADA directamente.
   */
  async submit(tenantId: string, usuarioId: string, id: string) {
    const [req] = await this.db.tx
      .select()
      .from(requisiciones)
      .where(and(eq(requisiciones.tenantId, tenantId), eq(requisiciones.id, id)))
      .limit(1);

    if (!req) throw new NotFoundException(`Requisición ${id} no encontrada.`);
    if (req.estado !== 'BORRADOR') {
      throw new BadRequestException(`Solo se puede someter una requisición en estado BORRADOR. Estado actual: ${req.estado}`);
    }

    // Obtener líneas
    const lineas = await this.db.tx
      .select()
      .from(lineasRequisicion)
      .where(eq(lineasRequisicion.requisicionId, id));

    // Calcular total estimado por partida
    const totalPorPartida = new Map<string, Decimal>();
    for (const linea of lineas) {
      const total = new Decimal(linea.precioEstimado).mul(new Decimal(linea.cantidad));
      const acum = totalPorPartida.get(linea.partidaId) ?? new Decimal(0);
      totalPorPartida.set(linea.partidaId, acum.plus(total));
    }

    // Validar disponible por partida
    let hayExceso = false;
    const excesos: { partidaId: string; total: string; disponible: string }[] = [];

    for (const [partidaId, totalEstimado] of totalPorPartida.entries()) {
      const disp = await this.disponibilidadSvc.getDisponiblePartida(
        tenantId,
        req.proyectoId,
        partidaId,
      );
      const disponible = new Decimal(disp.disponible);

      if (totalEstimado.greaterThan(disponible)) {
        hayExceso = true;
        excesos.push({
          partidaId,
          total: totalEstimado.toFixed(4),
          disponible: disponible.toFixed(4),
        });
      }
    }

    const now = new Date();
    let nuevoEstado: string;
    let instanciaFlujoId: string | null = null;

    if (hayExceso) {
      // Dispara flujo excepcional — no bloquea, pero requiere aprobación superior
      nuevoEstado = 'PENDIENTE_APROBACION';

      try {
        const instancia = await this.workflowSvc.iniciarFlujo(tenantId, usuarioId, {
          tipoDocumento: 'REQUISICION_EXCESO',
          documentoId: id,
          documentoTabla: 'requisicion',
          monto: excesos[0]!.total,
          moneda: 'DOP',
          descripcion: `Requisición excede disponible de presupuesto en ${excesos.length} partida(s).`,
          metadata: { excesos },
        });
        instanciaFlujoId = instancia.id;
      } catch (err) {
        // Si no hay tipo de flujo configurado para REQUISICION_EXCESO, solo se marca como pendiente
        this.logger.warn(`No se pudo iniciar flujo excepcional para requisición ${id}: ${String(err)}`);
      }
    } else {
      nuevoEstado = 'APROBADA';
    }

    const [updated] = await this.db.tx
      .update(requisiciones)
      .set({
        estado: nuevoEstado as 'APROBADA' | 'PENDIENTE_APROBACION',
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(requisiciones.id, id))
      .returning();

    return {
      ...updated!,
      superaDisponible: hayExceso,
      excesos,
      instanciaFlujoId,
    };
  }

  async findAll(tenantId: string, proyectoId?: string) {
    return this.db.tx
      .select()
      .from(requisiciones)
      .where(
        and(
          eq(requisiciones.tenantId, tenantId),
          proyectoId ? eq(requisiciones.proyectoId, proyectoId) : undefined,
          isNull(requisiciones.deletedAt),
        ),
      );
  }

  async findById(tenantId: string, id: string) {
    const [req] = await this.db.tx
      .select()
      .from(requisiciones)
      .where(and(eq(requisiciones.tenantId, tenantId), eq(requisiciones.id, id)))
      .limit(1);

    if (!req) throw new NotFoundException(`Requisición ${id} no encontrada.`);

    const lineas = await this.db.tx
      .select()
      .from(lineasRequisicion)
      .where(eq(lineasRequisicion.requisicionId, id));

    return { ...req, lineas };
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    );
  }
}
