import type { BookingStatus, PaymentStatus } from '@prisma/client';

/**
 * The single definition of which booking status changes are allowed.
 *
 *   PENDING   → CONFIRMED  (payment succeeded)
 *   PENDING   → FAILED     (payment failed)
 *   PENDING   → CANCELLED  (user cancelled before paying)
 *   CONFIRMED → CANCELLED  (user cancelled after paying; refunds are out of scope)
 *   FAILED, CANCELLED     → terminal, nothing further is allowed
 *
 * If a payment settles for a booking that was CANCELLED while the payment was pending, the payment
 * is recorded but the booking stays CANCELLED (see services/paymentSettlement.ts).
 */
export const ALLOWED_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING: ['CONFIRMED', 'FAILED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  FAILED: [],
  CANCELLED: [],
};

export const canTransition = (from: BookingStatus, to: BookingStatus) =>
  ALLOWED_TRANSITIONS[from].includes(to);

/** Every status that is allowed to move to `to`. Used in conditional (atomic) updates. */
export const statusesThatCanBecome = (to: BookingStatus): BookingStatus[] =>
  (Object.keys(ALLOWED_TRANSITIONS) as BookingStatus[]).filter((from) => canTransition(from, to));

/** The booking status a final payment outcome moves a PENDING booking to. */
export const BOOKING_STATUS_FOR_PAYMENT: Record<
  Exclude<PaymentStatus, 'PENDING'>,
  BookingStatus
> = {
  SUCCESS: 'CONFIRMED',
  FAILED: 'FAILED',
};
