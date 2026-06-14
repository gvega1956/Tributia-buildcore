import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { eq, and, isNull, asc, count } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { partidas, type PartidaInsert, type PartidaSelect } from '../db/schema/proyectos/partida.js';
import { eventosOperativos } from '../db/schema/ledger/evento_operativo.js';
import { newId } from '@tributia/shared';
import type { PartidaCreateInput, PartidaUpdateInput } from '@tributia/proyectos';
import { ProyectoService } from './proyecto.service.js';

@Injectable()
export class PartidaService {
  constructor(
    private readonly db: DbService,
    private readonly proyectoService: ProyectoService,
  ) {}

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    input: PartidaCreateInput,
  ): Promise<PartidaSelect> {
    // Verificar acceso al proyecto (lanza 403/404 si no tiene acceso)
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);

    const parentId = input.parentId ?? null;
    let nivel: number;
    let parentNumero: string | null = null;

    if (parentId) {
      const parent = await this.findRaw(tenantId, proyectoId, parentId);
      nivel = parent.nivel + 1;
      if (nivel > 3) {
        throw new UnprocessableEntityException(
          'El nivel máximo permitido en la EDT es 3 (Capítulo → Partida → Sub-partida).',
        );
      }
      parentNumero = parent.numeroJerarquico;
    } else {
      nivel = 1;
    }

    // Orden = siguiente posición entre hermanos activos
    const hermanos = await this.getSiblingsActivos(tenantId, proyectoId, parentId);
    const orden = hermanos.length + 1;
    const numeroJerarquico = this.computeNumero(parentNumero, orden);

    const now = new Date();
    const data: PartidaInsert = {
      id: newId(),
      tenantId,
      proyectoId,
      parentId,
      nivel,
      orden,
      numeroJerarquico,
      codigo: input.codigo,
      nombre: input.nombre,
      descripcion: input.descripcion ?? null,
      unidadMedidaId: input.unidadMedidaId ?? null,
      cantidadPresupuestada: input.cantidadPresupuestada ?? null,
      precioUnitario: input.precioUnitario ?? null,
      activo: true,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };

    try {
      const [row] = await this.db.tx.insert(partidas).values(data).returning();
      return row!;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException(
          `Ya existe una partida con código '${input.codigo}' en este proyecto.`,
        );
      }
      throw err;
    }
  }

  /**
   * Retorna todas las partidas activas del proyecto ordenadas jerárquicamente.
   * El orden numérico correcto (1.10 > 1.9) se garantiza parseando el numero_jerarquico.
   */
  async findTree(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
  ): Promise<PartidaSelect[]> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);

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

    return rows.sort((a, b) => this.compareNumero(a.numeroJerarquico, b.numeroJerarquico));
  }

  async findById(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    id: string,
  ): Promise<PartidaSelect> {
    await this.proyectoService.findById(proyectoId, tenantId, empresaId, usuarioId);
    return this.findRaw(tenantId, proyectoId, id);
  }

  async update(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    id: string,
    input: PartidaUpdateInput,
  ): Promise<PartidaSelect> {
    await this.findById(tenantId, proyectoId, empresaId, usuarioId, id);

    const [row] = await this.db.tx
      .update(partidas)
      .set({
        ...(input.codigo !== undefined && { codigo: input.codigo }),
        ...(input.nombre !== undefined && { nombre: input.nombre }),
        ...(input.descripcion !== undefined && { descripcion: input.descripcion ?? null }),
        ...(input.unidadMedidaId !== undefined && { unidadMedidaId: input.unidadMedidaId ?? null }),
        ...(input.cantidadPresupuestada !== undefined && {
          cantidadPresupuestada: input.cantidadPresupuestada ?? null,
        }),
        ...(input.precioUnitario !== undefined && {
          precioUnitario: input.precioUnitario ?? null,
        }),
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(partidas.id, id))
      .returning();

    return row!;
  }

  /**
   * Soft-delete de una partida.
   * Reglas (verificadas en orden):
   *   1. No tiene hijos activos  → 422
   *   2. No tiene movimientos    → 409
   *   3. Soft-delete y recompactar orden de hermanos.
   */
  async softDelete(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
    const partida = await this.findById(tenantId, proyectoId, empresaId, usuarioId, id);

    // 1. Verificar que no tiene hijos activos
    if (await this.hasHijosActivos(id)) {
      throw new UnprocessableEntityException(
        'La partida tiene sub-partidas activas. Elimínelas primero.',
      );
    }

    // 2. Verificar que no tiene movimientos (eventos del ledger)
    if (await this.hasMovimientos(id)) {
      throw new ConflictException(
        'La partida tiene movimientos registrados en el Ledger y no puede eliminarse.',
      );
    }

    const now = new Date();
    await this.db.tx
      .update(partidas)
      .set({
        activo: false,
        deletedAt: now,
        deletedBy: usuarioId,
        updatedAt: now,
        updatedBy: usuarioId,
      })
      .where(eq(partidas.id, id));

    // Recompactar orden de los hermanos restantes
    await this.recompactarHermanos(tenantId, proyectoId, partida.parentId, usuarioId);
  }

  /**
   * Reordena una partida dentro de sus hermanos.
   * Actualiza el `orden` de todos los hermanos afectados y propaga
   * el `numero_jerarquico` recursivamente por el sub-árbol de cada nodo movido.
   *
   * Retorna los hermanos activos en el nuevo orden.
   */
  async reordenar(
    tenantId: string,
    proyectoId: string,
    empresaId: string,
    usuarioId: string,
    id: string,
    nuevaPosicion: number,
  ): Promise<PartidaSelect[]> {
    const partida = await this.findById(tenantId, proyectoId, empresaId, usuarioId, id);

    const hermanos = await this.getSiblingsActivos(tenantId, proyectoId, partida.parentId);

    if (nuevaPosicion < 1 || nuevaPosicion > hermanos.length) {
      throw new UnprocessableEntityException(
        `Posición inválida (${nuevaPosicion}). Debe ser entre 1 y ${hermanos.length}.`,
      );
    }

    // Extraer la partida de la lista e insertarla en la nueva posición
    const sinEsta = hermanos.filter((h) => h.id !== id);
    sinEsta.splice(nuevaPosicion - 1, 0, partida);

    // Obtener el numero del padre para computar el nuevo numero de hermanos
    let parentNumero: string | null = null;
    if (partida.parentId) {
      const parent = await this.findRaw(tenantId, proyectoId, partida.parentId);
      parentNumero = parent.numeroJerarquico;
    }

    const updatedSiblings: PartidaSelect[] = [];
    for (let i = 0; i < sinEsta.length; i++) {
      const hermano = sinEsta[i]!;
      const nuevoOrden = i + 1;
      const nuevoNumero = this.computeNumero(parentNumero, nuevoOrden);

      const [updated] = await this.db.tx
        .update(partidas)
        .set({
          orden: nuevoOrden,
          numeroJerarquico: nuevoNumero,
          updatedAt: new Date(),
          updatedBy: usuarioId,
        })
        .where(eq(partidas.id, hermano.id))
        .returning();

      updatedSiblings.push(updated!);

      // Propagar el cambio al sub-árbol del hermano si su numero cambió
      if (hermano.numeroJerarquico !== nuevoNumero) {
        await this.recomputarSubarbol(hermano.id, nuevoNumero, usuarioId);
      }
    }

    return updatedSiblings;
  }

  // ── Helpers privados ──────────────────────────────────────────────────────

  /** Carga una partida activa sin verificar acceso al proyecto (uso interno). */
  private async findRaw(
    tenantId: string,
    proyectoId: string,
    id: string,
  ): Promise<PartidaSelect> {
    const [row] = await this.db.tx
      .select()
      .from(partidas)
      .where(
        and(
          eq(partidas.id, id),
          eq(partidas.tenantId, tenantId),
          eq(partidas.proyectoId, proyectoId),
          eq(partidas.activo, true),
          isNull(partidas.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException(`Partida '${id}' no encontrada en el proyecto.`);
    }
    return row;
  }

  /** Hermanos activos (mismo parent_id) ordenados por orden ASC. */
  private async getSiblingsActivos(
    tenantId: string,
    proyectoId: string,
    parentId: string | null,
  ): Promise<PartidaSelect[]> {
    return this.db.tx
      .select()
      .from(partidas)
      .where(
        and(
          eq(partidas.tenantId, tenantId),
          eq(partidas.proyectoId, proyectoId),
          parentId ? eq(partidas.parentId, parentId) : isNull(partidas.parentId),
          eq(partidas.activo, true),
          isNull(partidas.deletedAt),
        ),
      )
      .orderBy(asc(partidas.orden));
  }

  /** Renumera (orden + numero_jerarquico) los hermanos activos restantes tras un soft-delete. */
  private async recompactarHermanos(
    tenantId: string,
    proyectoId: string,
    parentId: string | null,
    usuarioId: string,
  ): Promise<void> {
    const hermanos = await this.getSiblingsActivos(tenantId, proyectoId, parentId);

    let parentNumero: string | null = null;
    if (parentId) {
      const parent = await this.db.tx
        .select({ numero: partidas.numeroJerarquico })
        .from(partidas)
        .where(eq(partidas.id, parentId))
        .limit(1);
      parentNumero = parent[0]?.numero ?? null;
    }

    for (let i = 0; i < hermanos.length; i++) {
      const hermano = hermanos[i]!;
      const nuevoOrden = i + 1;
      const nuevoNumero = this.computeNumero(parentNumero, nuevoOrden);

      if (hermano.orden !== nuevoOrden || hermano.numeroJerarquico !== nuevoNumero) {
        await this.db.tx
          .update(partidas)
          .set({ orden: nuevoOrden, numeroJerarquico: nuevoNumero, updatedAt: new Date(), updatedBy: usuarioId })
          .where(eq(partidas.id, hermano.id));

        if (hermano.numeroJerarquico !== nuevoNumero) {
          await this.recomputarSubarbol(hermano.id, nuevoNumero, usuarioId);
        }
      }
    }
  }

  /**
   * Recorre recursivamente los hijos activos de `parentId` y actualiza
   * su `numero_jerarquico` a partir del nuevo numero del padre.
   * Solo modifica filas donde el numero realmente cambia.
   */
  private async recomputarSubarbol(
    parentId: string,
    parentNumero: string,
    usuarioId: string,
  ): Promise<void> {
    const hijos = await this.db.tx
      .select()
      .from(partidas)
      .where(
        and(
          eq(partidas.parentId, parentId),
          eq(partidas.activo, true),
          isNull(partidas.deletedAt),
        ),
      )
      .orderBy(asc(partidas.orden));

    for (const hijo of hijos) {
      const nuevoNumero = this.computeNumero(parentNumero, hijo.orden);
      if (hijo.numeroJerarquico !== nuevoNumero) {
        await this.db.tx
          .update(partidas)
          .set({ numeroJerarquico: nuevoNumero, updatedAt: new Date(), updatedBy: usuarioId })
          .where(eq(partidas.id, hijo.id));

        await this.recomputarSubarbol(hijo.id, nuevoNumero, usuarioId);
      }
    }
  }

  /** true si la partida tiene hijos activos (impide soft-delete). */
  private async hasHijosActivos(id: string): Promise<boolean> {
    const rows = await this.db.tx
      .select({ value: count() })
      .from(partidas)
      .where(
        and(
          eq(partidas.parentId, id),
          eq(partidas.activo, true),
          isNull(partidas.deletedAt),
        ),
      );
    return Number(rows[0]?.value ?? 0) > 0;
  }

  /**
   * true si la partida tiene eventos en el Ledger (impide soft-delete).
   * Usa adminDb con filtro explícito para no depender del SET LOCAL del request.
   */
  private async hasMovimientos(id: string): Promise<boolean> {
    const rows = await this.db.adminDb
      .select({ value: count() })
      .from(eventosOperativos)
      .where(eq(eventosOperativos.partidaId, id));
    return Number(rows[0]?.value ?? 0) > 0;
  }

  /** numero_jerarquico = parentNumero + "." + orden (o solo String(orden) en raíz). */
  private computeNumero(parentNumero: string | null, orden: number): string {
    return parentNumero !== null ? `${parentNumero}.${orden}` : String(orden);
  }

  /** Comparador numérico para numero_jerarquico (1.10 > 1.9, no < como en orden lexicográfico). */
  private compareNumero(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] ?? 0;
      const bVal = bParts[i] ?? 0;
      if (aVal !== bVal) return aVal - bVal;
    }
    return 0;
  }
}

