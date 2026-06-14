import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import {
  proyectos,
  type ProyectoInsert,
  type ProyectoSelect,
} from '../db/schema/proyectos/proyecto.js';
import * as schema from '../db/schema/index.js';
import { newId } from '@tributia/shared';
import { PERMISSIONS } from '@tributia/core';
import {
  validarTransicion,
  TransicionInvalidaError,
  type ProyectoCreateInput,
  type ProyectoUpdateInput,
  type EstadoProyecto,
  type AsignarEquipoInput,
} from '@tributia/proyectos';

@Injectable()
export class ProyectoService {
  constructor(private readonly db: DbService) {}

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    empresaId: string,
    usuarioId: string,
    input: ProyectoCreateInput,
  ): Promise<ProyectoSelect> {
    // Verificar que el tercero existe y tiene rol cliente
    const [tercero] = await this.db.tx
      .select({ id: schema.terceros.id, esCliente: schema.terceros.esCliente })
      .from(schema.terceros)
      .where(
        and(
          eq(schema.terceros.id, input.clienteId),
          eq(schema.terceros.tenantId, tenantId),
          isNull(schema.terceros.deletedAt),
        ),
      )
      .limit(1);

    if (!tercero) {
      throw new NotFoundException(`Tercero '${input.clienteId}' no encontrado.`);
    }
    if (!tercero.esCliente) {
      throw new UnprocessableEntityException(
        `El tercero '${input.clienteId}' no tiene el rol cliente activado.`,
      );
    }

    const now = new Date();
    const data: ProyectoInsert = {
      id: newId(),
      tenantId,
      empresaId,
      codigo: input.codigo,
      nombre: input.nombre,
      descripcion: input.descripcion ?? null,
      estado: 'PROSPECTO',
      tipoObra: input.tipoObra,
      clienteId: input.clienteId,
      numeroContrato: input.numeroContrato ?? null,
      montoContrato: input.montoContrato ?? null,
      monedaContrato: input.monedaContrato ?? 'DOP',
      fechaInicioPlanificada: input.fechaInicioPlanificada ?? null,
      fechaFinPlanificada: input.fechaFinPlanificada ?? null,
      fechaInicioReal: null,
      fechaFinReal: null,
      ubicacionDescripcion: input.ubicacionDescripcion ?? null,
      latitud: input.latitud != null ? String(input.latitud) : null,
      longitud: input.longitud != null ? String(input.longitud) : null,
      activo: true,
      createdAt: now,
      createdBy: usuarioId,
      updatedAt: now,
      updatedBy: usuarioId,
    };

    try {
      const [row] = await this.db.tx.insert(proyectos).values(data).returning();
      return row!;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException(
          `Ya existe un proyecto con código '${input.codigo}' en esta empresa.`,
        );
      }
      throw err;
    }
  }

  async findAll(
    tenantId: string,
    empresaId: string,
    usuarioId: string,
  ): Promise<ProyectoSelect[]> {
    const puedeVerTodo = await this.hasEmpresaPermission(
      usuarioId,
      empresaId,
      tenantId,
      PERMISSIONS.PROYECTO_READ,
    );

    if (puedeVerTodo) {
      return this.db.tx
        .select()
        .from(proyectos)
        .where(
          and(
            eq(proyectos.tenantId, tenantId),
            eq(proyectos.empresaId, empresaId),
            eq(proyectos.activo, true),
            isNull(proyectos.deletedAt),
          ),
        )
        .orderBy(proyectos.nombre);
    }

    // Acceso a nivel de proyecto: devuelve solo los asignados
    const asignados = await this.getProyectosAsignados(usuarioId, tenantId);
    if (asignados.length === 0) return [];

    return this.db.tx
      .select()
      .from(proyectos)
      .where(
        and(
          eq(proyectos.tenantId, tenantId),
          eq(proyectos.empresaId, empresaId),
          eq(proyectos.activo, true),
          isNull(proyectos.deletedAt),
          inArray(proyectos.id, asignados),
        ),
      )
      .orderBy(proyectos.nombre);
  }

  async findById(
    id: string,
    tenantId: string,
    empresaId: string,
    usuarioId: string,
  ): Promise<ProyectoSelect> {
    const [row] = await this.db.tx
      .select()
      .from(proyectos)
      .where(and(eq(proyectos.id, id), isNull(proyectos.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundException(`Proyecto '${id}' no encontrado.`);

    await this.assertAccess(usuarioId, empresaId, tenantId, id);
    return row;
  }

  /** Devuelve el proyecto SIN verificación de acceso (uso interno: state machine). */
  private async findRaw(id: string): Promise<ProyectoSelect> {
    const [row] = await this.db.tx
      .select()
      .from(proyectos)
      .where(and(eq(proyectos.id, id), isNull(proyectos.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException(`Proyecto '${id}' no encontrado.`);
    return row;
  }

  async update(
    id: string,
    tenantId: string,
    empresaId: string,
    usuarioId: string,
    input: ProyectoUpdateInput,
  ): Promise<ProyectoSelect> {
    await this.findById(id, tenantId, empresaId, usuarioId);

    if (input.clienteId !== undefined) {
      const [tercero] = await this.db.tx
        .select({ id: schema.terceros.id, esCliente: schema.terceros.esCliente })
        .from(schema.terceros)
        .where(
          and(
            eq(schema.terceros.id, input.clienteId),
            eq(schema.terceros.tenantId, tenantId),
            isNull(schema.terceros.deletedAt),
          ),
        )
        .limit(1);

      if (!tercero) throw new NotFoundException(`Tercero '${input.clienteId}' no encontrado.`);
      if (!tercero.esCliente) {
        throw new UnprocessableEntityException(
          `El tercero '${input.clienteId}' no tiene el rol cliente activado.`,
        );
      }
    }

    const [row] = await this.db.tx
      .update(proyectos)
      .set({
        ...(input.codigo !== undefined && { codigo: input.codigo }),
        ...(input.nombre !== undefined && { nombre: input.nombre }),
        ...(input.descripcion !== undefined && { descripcion: input.descripcion ?? null }),
        ...(input.tipoObra !== undefined && { tipoObra: input.tipoObra }),
        ...(input.clienteId !== undefined && { clienteId: input.clienteId }),
        ...(input.numeroContrato !== undefined && { numeroContrato: input.numeroContrato ?? null }),
        ...(input.montoContrato !== undefined && { montoContrato: input.montoContrato ?? null }),
        ...(input.monedaContrato !== undefined && { monedaContrato: input.monedaContrato }),
        ...(input.fechaInicioPlanificada !== undefined && {
          fechaInicioPlanificada: input.fechaInicioPlanificada ?? null,
        }),
        ...(input.fechaFinPlanificada !== undefined && {
          fechaFinPlanificada: input.fechaFinPlanificada ?? null,
        }),
        ...(input.ubicacionDescripcion !== undefined && {
          ubicacionDescripcion: input.ubicacionDescripcion ?? null,
        }),
        ...(input.latitud !== undefined && {
          latitud: input.latitud != null ? String(input.latitud) : null,
        }),
        ...(input.longitud !== undefined && {
          longitud: input.longitud != null ? String(input.longitud) : null,
        }),
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(proyectos.id, id))
      .returning();

    return row!;
  }

  async softDelete(
    id: string,
    tenantId: string,
    empresaId: string,
    usuarioId: string,
  ): Promise<void> {
    await this.findById(id, tenantId, empresaId, usuarioId);
    await this.db.tx
      .update(proyectos)
      .set({
        activo: false,
        deletedAt: new Date(),
        deletedBy: usuarioId,
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(proyectos.id, id));
  }

  // ── Ciclo de estados ─────────────────────────────────────────────────────

  async transicionarEstado(
    id: string,
    tenantId: string,
    empresaId: string,
    usuarioId: string,
    nuevoEstado: EstadoProyecto,
  ): Promise<ProyectoSelect> {
    const proyecto = await this.findRaw(id);

    try {
      validarTransicion(proyecto.estado, nuevoEstado);
    } catch (err) {
      if (err instanceof TransicionInvalidaError) {
        throw new UnprocessableEntityException(err.message);
      }
      throw err;
    }

    const extras: Partial<ProyectoInsert> = {};
    if (nuevoEstado === 'EN_EJECUCION' && !proyecto.fechaInicioReal) {
      extras.fechaInicioReal = new Date().toISOString().substring(0, 10);
    }
    if (nuevoEstado === 'CERRADO' && !proyecto.fechaFinReal) {
      extras.fechaFinReal = new Date().toISOString().substring(0, 10);
    }

    const [row] = await this.db.tx
      .update(proyectos)
      .set({
        estado: nuevoEstado,
        ...extras,
        updatedAt: new Date(),
        updatedBy: usuarioId,
      })
      .where(eq(proyectos.id, id))
      .returning();

    return row!;
  }

  // ── Equipo del proyecto ───────────────────────────────────────────────────

  async asignarEquipo(
    proyectoId: string,
    tenantId: string,
    usuarioId: string,
    input: AsignarEquipoInput,
  ): Promise<schema.UsuarioRolProyectoSelect> {
    // Verificar que el proyecto existe (RLS garantiza tenant)
    await this.findRaw(proyectoId);

    const now = new Date();
    try {
      const [row] = await this.db.tx
        .insert(schema.usuarioRolProyecto)
        .values({
          id: newId(),
          tenantId,
          usuarioId: input.usuarioId,
          proyectoId,
          rolId: input.rolId,
          createdAt: now,
          createdBy: usuarioId,
          updatedAt: now,
          updatedBy: usuarioId,
        })
        .returning();
      return row!;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException('El usuario ya está asignado a este proyecto.');
      }
      throw err;
    }
  }

  async removerEquipo(
    proyectoId: string,
    miembroUsuarioId: string,
    tenantId: string,
    usuarioId: string,
  ): Promise<void> {
    await this.findRaw(proyectoId);
    const result = await this.db.tx
      .delete(schema.usuarioRolProyecto)
      .where(
        and(
          eq(schema.usuarioRolProyecto.proyectoId, proyectoId),
          eq(schema.usuarioRolProyecto.usuarioId, miembroUsuarioId),
          eq(schema.usuarioRolProyecto.tenantId, tenantId),
        ),
      )
      .returning({ id: schema.usuarioRolProyecto.id });

    if (result.length === 0) {
      throw new NotFoundException('El usuario no está asignado a este proyecto.');
    }
    void usuarioId;
  }

  async listarEquipo(
    proyectoId: string,
    tenantId: string,
    empresaId: string,
    usuarioId: string,
  ): Promise<schema.UsuarioRolProyectoSelect[]> {
    await this.assertAccess(usuarioId, empresaId, tenantId, proyectoId);
    return this.db.tx
      .select()
      .from(schema.usuarioRolProyecto)
      .where(
        and(
          eq(schema.usuarioRolProyecto.proyectoId, proyectoId),
          eq(schema.usuarioRolProyecto.tenantId, tenantId),
        ),
      );
  }

  // ── Control de acceso ─────────────────────────────────────────────────────

  /**
   * Verifica que el usuario puede acceder al proyecto:
   *   1. Tiene proyecto:read a nivel empresa, O
   *   2. Está asignado a este proyecto en usuario_rol_proyecto.
   * Lanza ForbiddenException si no.
   */
  private async assertAccess(
    usuarioId: string,
    empresaId: string,
    tenantId: string,
    proyectoId: string,
  ): Promise<void> {
    const tieneEmpresa = await this.hasEmpresaPermission(
      usuarioId,
      empresaId,
      tenantId,
      PERMISSIONS.PROYECTO_READ,
    );
    if (tieneEmpresa) return;

    const [asignado] = await this.db.adminDb
      .select({ id: schema.usuarioRolProyecto.id })
      .from(schema.usuarioRolProyecto)
      .where(
        and(
          eq(schema.usuarioRolProyecto.usuarioId, usuarioId),
          eq(schema.usuarioRolProyecto.proyectoId, proyectoId),
          eq(schema.usuarioRolProyecto.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!asignado) {
      throw new ForbiddenException('Sin acceso a este proyecto.');
    }
  }

  private async hasEmpresaPermission(
    usuarioId: string,
    empresaId: string,
    tenantId: string,
    permiso: string,
  ): Promise<boolean> {
    const rows = await this.db.adminDb
      .select({ permiso: schema.rolPermisos.permiso })
      .from(schema.rolPermisos)
      .innerJoin(
        schema.usuarioRolEmpresa,
        and(
          eq(schema.rolPermisos.rolId, schema.usuarioRolEmpresa.rolId),
          eq(schema.usuarioRolEmpresa.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(schema.usuarioRolEmpresa.usuarioId, usuarioId),
          eq(schema.usuarioRolEmpresa.empresaId, empresaId),
          eq(schema.usuarioRolEmpresa.tenantId, tenantId),
          eq(schema.rolPermisos.permiso, permiso),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private async getProyectosAsignados(
    usuarioId: string,
    tenantId: string,
  ): Promise<string[]> {
    const rows = await this.db.adminDb
      .select({ proyectoId: schema.usuarioRolProyecto.proyectoId })
      .from(schema.usuarioRolProyecto)
      .where(
        and(
          eq(schema.usuarioRolProyecto.usuarioId, usuarioId),
          eq(schema.usuarioRolProyecto.tenantId, tenantId),
        ),
      );
    return rows.map((r) => r.proyectoId);
  }
}
