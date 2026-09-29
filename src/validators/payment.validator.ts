import { z } from 'zod';

// strictObject: an "amount" in the body is rejected with 400 — the amount always comes from the
// booking. simulateOutcome exists only because the provider is a mock (see README):
//   omitted              → payment stays PENDING until the provider's webhook settles it (202)
//   "SUCCESS" | "FAILED" → the mock settles it immediately (201)
export const createPaymentSchema = z.strictObject({
  bookingId: z.uuid('bookingId must be a valid UUID'),
  simulateOutcome: z.enum(['SUCCESS', 'FAILED']).optional(),
});

// What the payment provider sends. It knows its own payment reference, not our booking IDs.
export const paymentWebhookSchema = z.strictObject({
  eventId: z.string().trim().min(1).max(200),
  providerPaymentId: z.string().trim().min(1).max(200),
  status: z.enum(['SUCCESS', 'FAILED']),
  // In paise, like real gateways (Razorpay/Stripe send amounts in the smallest currency unit).
  amount: z.int().positive(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type PaymentWebhookEvent = z.infer<typeof paymentWebhookSchema>;
