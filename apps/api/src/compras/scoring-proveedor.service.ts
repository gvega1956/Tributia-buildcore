import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DbService } from '../database/db.service.js';
import { scoringProveedor } from '../db/schema/compras/scoring_proveedor.js';

@Injectable()
export class ScoringProveedorService {
  constructor(private readonly db: DbService) {}

  async getScoring(tenantId: string, terceroId: string) {
    const [scoring] = await this.db.tx
      .select()
      .from(scoringProveedor)
      .where(
        and(
          eq(scoringProveedor.tenantId, tenantId),
          eq(scoringProveedor.terceroId, terceroId),
        ),
      )
      .limit(1);

    if (!scoring) {
      throw new NotFoundException(
        `No hay historial de scoring para el proveedor ${terceroId}`,
      );
    }

    return scoring;
  }

  async listar(tenantId: string) {
    return this.db.tx
      .select()
      .from(scoringProveedor)
      .where(eq(scoringProveedor.tenantId, tenantId));
  }
}
