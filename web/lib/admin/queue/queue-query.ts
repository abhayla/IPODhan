/** Validation of the admin queue's query string (security-baseline: validate at the edge). */
import { z } from 'zod';

export const QueueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  group: z.coerce.number().int().min(1).max(3).optional(),
  kind: z.enum(['disagreement', 'missing', 'ruled']).optional(),
  reason: z.string().trim().min(1).max(200).optional(),
  ipo: z.string().trim().regex(/^[a-z0-9-]{1,255}$/).optional(),
});

export type QueueQuery = z.infer<typeof QueueQuerySchema>;
