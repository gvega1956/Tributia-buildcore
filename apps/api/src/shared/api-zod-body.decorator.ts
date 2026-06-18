import { ApiBody } from '@nestjs/swagger';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Decorador NestJS que registra el body Zod en el spec OpenAPI.
 * Úsalo en lugar de @ApiBody en cualquier endpoint que use zSchema.parse(body).
 */
// $refStrategy: 'none' expande inline todos los tipos — evita $defs que
// openapi-typescript (redoc bundler) no puede resolver como $ref externas.
export const ApiZodBody = (schema: ZodType<unknown, ZodTypeDef, unknown>) =>
  ApiBody({ schema: zodToJsonSchema(schema, { $refStrategy: 'none' }) as object });
