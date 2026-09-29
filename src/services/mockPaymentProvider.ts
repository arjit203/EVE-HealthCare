import { randomUUID } from 'node:crypto';
import type { PaymentStatus } from '@prisma/client';

/**
 * Stand-in for a real payment gateway. No money moves and no card/UPI details exist.
 * With simulateOutcome the result is immediate and deterministic (for testing); without it the
 * payment stays PENDING and the outcome arrives later through the webhook, as with a real gateway.
 */
export const mockPaymentProvider = {
  charge(input: { amountPaise: number; simulateOutcome?: 'SUCCESS' | 'FAILED' }) {
    const status: PaymentStatus = input.simulateOutcome ?? 'PENDING';
    return {
      providerPaymentId: `mock_pay_${randomUUID()}`,
      status,
      amountPaise: input.amountPaise,
    };
  },
};
