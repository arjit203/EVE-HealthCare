import type { BookingStatus, PaymentEventOutcome, PaymentStatus, Prisma } from '@prisma/client';
import { bookingRepository, type LockedBooking } from '../repositories/booking.repository';
import { paymentRepository } from '../repositories/payment.repository';
import { BOOKING_STATUS_FOR_PAYMENT, canTransition } from '../utils/bookingStatus';
import { logger } from '../utils/logger';

export interface SettlementResult {
  outcome: PaymentEventOutcome;
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
}

/**
 * The single place where a payment outcome is applied — used by POST /payments (immediate outcome)
 * and by the provider webhook. Must run inside a transaction that holds the booking's row lock,
 * and `payment` must have been read after taking that lock.
 *
 * A payment moves PENDING → SUCCESS | FAILED exactly once:
 *  - already in the requested status   → DUPLICATE_STATE, nothing changes
 *  - already settled the other way     → IGNORED_CONFLICT, nothing changes (logged)
 *  - PENDING                           → APPLIED: payment updated, and the booking follows the
 *    booking state machine. If the booking can no longer move (it was CANCELLED while the payment
 *    was pending), the payment is still recorded but the booking keeps its status (logged).
 */
export const settlePayment = async (
  tx: Prisma.TransactionClient,
  booking: LockedBooking,
  payment: { id: string; status: PaymentStatus; providerPaymentId: string },
  newStatus: 'SUCCESS' | 'FAILED',
): Promise<SettlementResult> => {
  const unchanged = { paymentStatus: payment.status, bookingStatus: booking.status };
  const context = {
    paymentId: payment.id,
    providerPaymentId: payment.providerPaymentId,
    bookingId: booking.id,
  };

  if (payment.status === newStatus) return { outcome: 'DUPLICATE_STATE', ...unchanged };

  if (payment.status !== 'PENDING') {
    logger.warn('Conflicting payment status ignored; payment is already settled', {
      ...context,
      currentStatus: payment.status,
      receivedStatus: newStatus,
      // FAILED then SUCCESS means the provider may have taken money for a payment we treat as
      // failed: that needs a human to reconcile (refund or confirm), not an automatic flip.
      ...(newStatus === 'SUCCESS' && { action: 'MANUAL_RECONCILIATION_REQUIRED' }),
    });
    return { outcome: 'IGNORED_CONFLICT', ...unchanged };
  }

  await paymentRepository.updateStatus(tx, payment.id, newStatus);

  const target = BOOKING_STATUS_FOR_PAYMENT[newStatus];
  if (!canTransition(booking.status, target)) {
    logger.warn('Payment settled but booking status left unchanged', {
      ...context,
      bookingStatus: booking.status,
      paymentStatus: newStatus,
      ...(newStatus === 'SUCCESS' && { action: 'REFUND_REQUIRED' }),
    });
    return { outcome: 'APPLIED', paymentStatus: newStatus, bookingStatus: booking.status };
  }

  await bookingRepository.updateStatus(tx, booking.id, target);
  return { outcome: 'APPLIED', paymentStatus: newStatus, bookingStatus: target };
};
