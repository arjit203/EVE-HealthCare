import { z } from 'zod';

// strictObject: an "amount" in the body is rejected with 400 — the amount always comes from the
// booking. simulateOutcome exists only because the provider is a mock (see README).
export const createPaymentSchema = z.strictObject({
  bookingId: z.uuid('bookingId must be a valid UUID'),
  simulateOutcome: z.enum(['SUCCESS', 'FAILED']).default('SUCCESS'),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
