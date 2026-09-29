import { isDeepStrictEqual } from 'node:util';
import { prisma } from '../config/prisma';
import { bookingRepository } from '../repositories/booking.repository';
import { paymentEventRepository, paymentRepository } from '../repositories/payment.repository';
import { AppError } from '../utils/AppError';
import { isUniqueViolation } from '../utils/prismaErrors';
import { logger } from '../utils/logger';
import type { PaymentWebhookEvent } from '../validators/payment.validator';
import { settlePayment } from './paymentSettlement';

type StoredEvent = NonNullable<
  Awaited<ReturnType<typeof paymentEventRepository.findByProviderEventId>>
>;

// Built only from the stored event, so every delivery of the same event gets an identical response.
const toResponse = (event: StoredEvent) => ({
  eventId: event.providerEventId,
  providerPaymentId: event.payment.providerPaymentId,
  status: event.status,
  outcome: event.outcome,
});

// The first delivery of an event ID is the one that counts; a redelivery with a different body
// is answered with the stored result and logged rather than applied.
const replayStoredEvent = (stored: StoredEvent, received: PaymentWebhookEvent) => {
  if (!isDeepStrictEqual(stored.payload, received)) {
    logger.warn('Webhook event redelivered with a different payload; stored result returned', {
      eventId: received.eventId,
      stored: stored.payload,
      received,
    });
  }
  return toResponse(stored);
};

export const webhookService = {
  /**
   * Processes one provider event. The webhook only ever updates an existing payment (and its
   * booking) — it never creates payments or bookings.
   *
   * Recording the event and applying it happen in ONE transaction. If anything fails midway,
   * both roll back, so the provider's retry is processed cleanly; if the event row were committed
   * separately, a crash before the update would make every retry look like a duplicate and the
   * payment would never settle.
   */
  async handle(event: PaymentWebhookEvent) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Level 1 idempotency: this exact event was already processed.
        const stored = await paymentEventRepository.findByProviderEventId(tx, event.eventId);
        if (stored) return replayStoredEvent(stored, event);

        const found = await paymentRepository.findByProviderPaymentId(tx, event.providerPaymentId);
        if (!found) throw AppError.notFound('Payment');

        // Same lock order as POST /payments and cancel (booking row first), then re-read the
        // payment so we act on its latest committed status, not the one read before waiting.
        const booking = await bookingRepository.lockById(tx, found.bookingId);
        const payment = await paymentRepository.findByProviderPaymentId(
          tx,
          event.providerPaymentId,
        );
        if (!booking || !payment) throw AppError.notFound('Payment');

        if (event.amount !== payment.amountPaise) {
          throw new AppError(
            422,
            'AMOUNT_MISMATCH',
            `Event amount ${event.amount} does not match payment amount ${payment.amountPaise}`,
          );
        }

        // Level 2 idempotency: a new event ID reporting a state the payment is already in.
        const result = await settlePayment(tx, booking, payment, event.status);

        const saved = await paymentEventRepository.create(tx, {
          providerEventId: event.eventId,
          paymentId: payment.id,
          status: event.status,
          outcome: result.outcome,
          payload: event,
        });
        return toResponse(saved);
      });
    } catch (err) {
      // Two deliveries of the same event raced: the other one committed first, and the unique
      // provider_event_id rejected (and rolled back) this one. Answer with the committed result.
      if (isUniqueViolation(err)) {
        const stored = await paymentEventRepository.findByProviderEventId(prisma, event.eventId);
        if (stored) return replayStoredEvent(stored, event);
      }
      throw err;
    }
  },
};
