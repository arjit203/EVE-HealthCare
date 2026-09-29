import { z } from 'zod';

export const createDiagnosticTestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().trim().max(1000).optional(),
});

export type CreateDiagnosticTestInput = z.infer<typeof createDiagnosticTestSchema>;
