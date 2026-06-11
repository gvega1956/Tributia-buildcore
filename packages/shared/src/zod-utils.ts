import { z } from 'zod';

export const zUUID = z.string().uuid();
export const zEntityId = z.string().min(1);
export const zBusinessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
export const zMoney = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a valid decimal with up to 4 decimal places'),
  currency: z.enum(['DOP', 'USD', 'EUR']),
});

export const zPaginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PaginationQuery = z.infer<typeof zPaginationQuery>;

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, query: PaginationQuery): PaginatedResult<T> {
  return {
    data: items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
}
