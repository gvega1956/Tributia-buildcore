import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { DbService } from '../database/db.service.js';
import {
  versionesPresupuesto,
  lineasPresupuesto,
  type VersionPresupuestoInsert,
  type VersionPresupuestoSelect,
  type LineaPresupuestoInsert,
  type LineaPresupuestoSelect,
} from '../db/schema/proyectos/presupuesto.js';
import { partidas } from '../db/schema/proyectos/partida.js';
import { apus } from '../db/schema/proyectos/apu.js';
import { newId } from '@tributia/shared';
import type {
  VersionPresupuestoCreateInput,
  LineaPresupuestoCreateInput,
  LineaPresupuestoUpdateInput,
  AprobarPresupuestoInput,
} from '@tributia/proyectos';
import { ProyectoService } from './proyecto.service.js';

export interface VersionConLineas extends VersionPresupuestoSelect {
  lineas: LineaPresupuestoSelect[];
}

@Injectable()
export class PresupuestoService {
  constructor(
    private readonly db: DbService,
    private readonly proyectoService: ProyectoService,
  ) {}

  // ── Versiones ─────────────────────────────────────────────────────────────

  async createVersion(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    input: VersionPresupuestoCreateInput,
  ): Promise<VersionConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);

    const now = new Date();
    const versionData: VersionPresupuestoInsert = {
      id: newId(),
      tenantId,
      proyectoId,
      nombre: input.nombre,
      tipo: input.tipo,
      estado: 'PENDIENTE',
      notas: input.notas ?? null,
      moneda: input.moneda,
      totalDirecto: '0.0000',
      totalIndirecto: '0.0000',
      totalPresupuesto: '0.0000',
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };

    const [version] = await this.db.tx
      .insert(versionesPresupuesto)
      .values(versionData)
      .returning();

    // Si snapshotPartidas=true, crear líneas desde las partidas actuales del proyecto
    if (input.snapshotPartidas) {
      await this.snapshotPartidasActuales(tenantId, version!.id, proyectoId, usuarioId, now);
    }

    return this.findVersionById(tenantId, proyectoId, empresaId, usuarioId, version!.id);
  }

  async findVersiones(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
  ): Promise<VersionPresupuestoSelect[]> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);

    return this.db.tx
      .select()
      .from(versionesPresupuesto)
      .where(
        and(
          eq(versionesPresupuesto.tenantId, tenantId),
          eq(versionesPresupuesto.proyectoId, proyectoId),
          isNull(versionesPresupuesto.deletedAt),
        ),
      );
  }

  async findVersionById(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    versionId: string,
  ): Promise<VersionConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    return this.findVersionRaw(tenantId, proyectoId, versionId);
  }

  async findPresupuestoVigente(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
  ): Promise<VersionConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);

    // Vigente = BASE aprobado. Sin OC todavía = mismo que BASE.
    const [version] = await this.db.tx
      .select()
      .from(versionesPresupuesto)
      .where(
        and(
          eq(versionesPresupuesto.tenantId, tenantId),
          eq(versionesPresupuesto.proyectoId, proyectoId),
          eq(versionesPresupuesto.tipo, 'BASE'),
          eq(versionesPresupuesto.estado, 'APROBADO'),
          isNull(versionesPresupuesto.deletedAt),
        ),
      )
      .limit(1);

    if (!version) {
      throw new NotFoundException(
        'El proyecto no tiene presupuesto base aprobado.',
      );
    }

    const lineas = await this.findLineasDeVersion(version.id);
    return { ...version, lineas };
  }

  // ── Líneas ─────────────────────────────────────────────────────────────────

  async addLinea(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    versionId: string,
    input: LineaPresupuestoCreateInput,
  ): Promise<VersionConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    const version = await this.findVersionRaw(tenantId, proyectoId, versionId);
    this.assertEditable(version);

    const total = new Decimal(input.cantidad).mul(new Decimal(input.precioUnitario)).toFixed(4);

    const lineaData: LineaPresupuestoInsert = {
      id: newId(),
      tenantId,
      versionPresupuestoId: versionId,
      partidaId: input.partidaId,
      apuId: input.apuId ?? null,
      cantidad: input.cantidad,
      precioUnitario: input.precioUnitario,
      total,
      moneda: version.moneda,
      esIndirecto: input.esIndirecto,
      createdAt: new Date(),
      createdBy: usuarioId,
      updatedAt: new Date(),
      updatedBy: usuarioId,
    };

    try {
      await this.db.tx.insert(lineasPresupuesto).values(lineaData);
    } catch (err: unknown) {
      if (
        typeof err === 'object' && err !== null && 'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException('Ya existe una línea para esta partida en la versión.');
      }
      throw err;
    }

    return this.recalcularTotalesYRetornar(tenantId, proyectoId, versionId, usuarioId);
  }

  async updateLinea(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    versionId: string,
    lineaId: string,
    input: LineaPresupuestoUpdateInput,
  ): Promise<VersionConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    const version = await this.findVersionRaw(tenantId, proyectoId, versionId);
    this.assertEditable(version);

    const [linea] = await this.db.tx
      .select()
      .from(lineasPresupuesto)
      .where(
        and(
          eq(lineasPresupuesto.id, lineaId),
          eq(lineasPresupuesto.versionPresupuestoId, versionId),
        ),
      )
      .limit(1);
    if (!linea) throw new NotFoundException(`Línea '${lineaId}' no encontrada.`);

    const newCantidad = input.cantidad ?? linea.cantidad;
    const newPrecio = input.precioUnitario ?? linea.precioUnitario;
    const total = new Decimal(newCantidad).mul(new Decimal(newPrecio)).toFixed(4);

    await this.db.tx
      .update(lineasPresupuesto)
      .set({
        ...(input.cantidad !== undefined && { cantidad: input.cantidad }),
        ...(input.precioUnitario !== undefined && { precioUnitario: input.precioUnitario }),
        ...(input.esIndirecto !== undefined && { esIndirecto: input.esIndirecto }),
        total,
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(lineasPresupuesto.id, lineaId));

    return this.recalcularTotalesYRetornar(tenantId, proyectoId, versionId, usuarioId);
  }

  async removeLinea(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    versionId: string,
    lineaId: string,
  ): Promise<VersionConLineas> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    const version = await this.findVersionRaw(tenantId, proyectoId, versionId);
    this.assertEditable(version);

    const deleted = await this.db.tx
      .delete(lineasPresupuesto)
      .where(
        and(
          eq(lineasPresupuesto.id, lineaId),
          eq(lineasPresupuesto.versionPresupuestoId, versionId),
        ),
      )
      .returning({ id: lineasPresupuesto.id });
    if (!deleted.length) throw new NotFoundException(`Línea '${lineaId}' no encontrada.`);

    return this.recalcularTotalesYRetornar(tenantId, proyectoId, versionId, usuarioId);
  }

  // ── Aprobación ────────────────────────────────────────────────────────────

  async aprobar(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    versionId: string,
    input: AprobarPresupuestoInput,
  ): Promise<VersionPresupuestoSelect> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    const version = await this.findVersionRaw(tenantId, proyectoId, versionId);

    if (version.estado !== 'PENDIENTE') {
      throw new UnprocessableEntityException(
        `La versión ya está en estado '${version.estado}'. Solo versiones PENDIENTE pueden aprobarse.`,
      );
    }

    const now = new Date();
    try {
      const [updated] = await this.db.tx
        .update(versionesPresupuesto)
        .set({
          estado: 'APROBADO',
          tipo: 'BASE',  // toda versión aprobada se convierte en el BASE del proyecto
          ...(input.notas !== undefined && input.notas !== null && { notas: input.notas }),
          aprobadoPor: usuarioId,
          aprobadoEn: now,
          updatedAt: now,
          updatedBy: usuarioId,
        })
        .where(eq(versionesPresupuesto.id, versionId))
        .returning();
      return updated!;
    } catch (err: unknown) {
      if (
        typeof err === 'object' && err !== null && 'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException(
          'Ya existe un presupuesto BASE aprobado para este proyecto. Rechaza el anterior antes de aprobar otro.',
        );
      }
      throw err;
    }
  }

  async rechazar(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    versionId: string,
    notas?: string,
  ): Promise<VersionPresupuestoSelect> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    const version = await this.findVersionRaw(tenantId, proyectoId, versionId);

    if (version.estado !== 'PENDIENTE') {
      throw new UnprocessableEntityException(
        `La versión ya está en estado '${version.estado}'.`,
      );
    }

    const [updated] = await this.db.tx
      .update(versionesPresupuesto)
      .set({
        estado: 'RECHAZADO',
        ...(notas && { notas }),
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(versionesPresupuesto.id, versionId))
      .returning();
    return updated!;
  }

  // ── Helpers internos ──────────────────────────────────────────────────────

  private async snapshotPartidasActuales(
    tenantId: string,
    versionId: string,
    proyectoId: string,
    usuarioId: string,
    now: Date,
  ): Promise<void> {
    const rows = await this.db.tx
      .select()
      .from(partidas)
      .where(
        and(
          eq(partidas.tenantId, tenantId),
          eq(partidas.proyectoId, proyectoId),
          eq(partidas.activo, true),
          isNull(partidas.deletedAt),
        ),
      );

    if (rows.length === 0) return;

    // Obtener el APU de cada partida (opcional)
    const apuRows = await this.db.tx
      .select({ id: apus.id, partidaId: apus.partidaId, precioUnitario: apus.precioUnitario })
      .from(apus)
      .where(and(eq(apus.tenantId, tenantId), isNull(apus.deletedAt)));

    const apuByPartida = new Map(apuRows.map((a) => [a.partidaId, a]));

    const lineas: LineaPresupuestoInsert[] = rows.map((p) => {
      const apu = apuByPartida.get(p.id);
      const precioUnitario = apu?.precioUnitario ?? p.precioUnitario ?? '0.0000';
      const cantidad = p.cantidadPresupuestada ?? '0.0000';
      const total = new Decimal(cantidad).mul(new Decimal(precioUnitario)).toFixed(4);

      return {
        id: newId(),
        tenantId,
        versionPresupuestoId: versionId,
        partidaId: p.id,
        apuId: apu?.id ?? null,
        cantidad,
        precioUnitario,
        total,
        moneda: 'DOP',
        esIndirecto: false,
        createdAt: now,
        createdBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      };
    });

    await this.db.tx.insert(lineasPresupuesto).values(lineas);
    await this.recalcularTotales(tenantId, versionId, usuarioId);
  }

  private async recalcularTotalesYRetornar(
    tenantId: string,
    proyectoId: string,
    versionId: string,
    usuarioId: string,
  ): Promise<VersionConLineas> {
    await this.recalcularTotales(tenantId, versionId, usuarioId);
    return this.findVersionRaw(tenantId, proyectoId, versionId);
  }

  private async recalcularTotales(
    tenantId: string,
    versionId: string,
    usuarioId: string,
  ): Promise<void> {
    const lineas = await this.findLineasDeVersion(versionId);

    let directo = new Decimal('0');
    let indirecto = new Decimal('0');

    for (const l of lineas) {
      if (l.esIndirecto) {
        indirecto = indirecto.plus(new Decimal(l.total));
      } else {
        directo = directo.plus(new Decimal(l.total));
      }
    }

    const total = directo.plus(indirecto);

    await this.db.tx
      .update(versionesPresupuesto)
      .set({
        totalDirecto: directo.toFixed(4),
        totalIndirecto: indirecto.toFixed(4),
        totalPresupuesto: total.toFixed(4),
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(versionesPresupuesto.id, versionId));
  }

  private async findLineasDeVersion(versionId: string): Promise<LineaPresupuestoSelect[]> {
    return this.db.tx
      .select()
      .from(lineasPresupuesto)
      .where(eq(lineasPresupuesto.versionPresupuestoId, versionId));
  }

  private async findVersionRaw(
    tenantId: string,
    proyectoId: string,
    versionId: string,
  ): Promise<VersionConLineas> {
    const [row] = await this.db.tx
      .select()
      .from(versionesPresupuesto)
      .where(
        and(
          eq(versionesPresupuesto.id, versionId),
          eq(versionesPresupuesto.tenantId, tenantId),
          eq(versionesPresupuesto.proyectoId, proyectoId),
          isNull(versionesPresupuesto.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException(`Versión de presupuesto '${versionId}' no encontrada.`);
    }

    const lineas = await this.findLineasDeVersion(versionId);
    return { ...row, lineas };
  }

  private assertEditable(version: VersionPresupuestoSelect): void {
    if (version.estado !== 'PENDIENTE') {
      throw new UnprocessableEntityException(
        `El presupuesto está en estado '${version.estado}' y no puede modificarse. Las versiones aprobadas son inmutables.`,
      );
    }
  }
}
