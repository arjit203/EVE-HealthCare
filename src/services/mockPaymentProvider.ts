import { randomUUID } from 'node:crypto';
import type { PaymentStatus } from '@prisma/client';

/**
 * Stand-in for a real payment gateway. No money moves and no card/UPI details exist.
 * The outcome is chosen by the caller (default SUCCESS) so that behaviour is deterministic and
 * testable; a real gateway would decide the outcome itself.
 */
export const mockPaymentProvider = {
  charge(input: { amountPaise: number; simulateOutcome: PaymentStatus }) {
    return {
      providerPaymentId: `mock_pay_${randomUUID()}`,
      status: input.simulateOutcome,
      amountPaise: input.amountPaise,
    };
  },
};
