import { prisma } from '../config/prisma';
import { bookingRepository } from '../repositories/booking.repository';
import { paymentRepository } from '../repositories/payment.repository';
import { AppError } from '../utils/AppError';
import { canTransition } from '../utils/bookingStatus';
import { isUniqueViolation } from '../utils/prismaErrors';
import type { CreatePaymentInput } from '../validators/payment.validator';
import { mockPaymentProvider } from './mockPaymentProvider';
import { settlePayment } from './paymentSettlement';

const paymentAlreadyExists = () =>
  new AppError(409, 'PAYMENT_ALREADY_EXISTS', 'This booking already has a payment');

export const paymentService = {
  /**
   * Starts a payment for one of the user's PENDING bookings. Everything happens in one transaction
   * with the booking row locked, so two concurrent payments (or a payment and a cancel) cannot
   * interleave. With simulateOutcome the payment is settled immediately; without it, it stays
   * PENDING until the webhook arrives. A FAILED outcome is still a successful request.
   */
  async pay(userId: string, input: CreatePaymentInput) {
    try {
      return await prisma.$transaction(async (tx) => {
        const booking = await bookingRepository.lockForUser(tx, input.bookingId, userId);
        if (!booking) throw AppError.notFound('Booking');

        // Only a PENDING booking can move to CONFIRMED/FAILED, i.e. be paid.
        if (!canTransition(booking.status, 'CONFIRMED')) {
          if (booking.status === 'CONFIRMED') throw paymentAlreadyExists();
          throw new AppError(
            409,
            'BOOKING_NOT_PAYABLE',
            `A ${booking.status} booking cannot be paid`,
          );
        }
        // A PENDING booking may already have a PENDING payment waiting for its webhook.
        if (await paymentRepository.findByBookingId(tx, booking.id)) throw paymentAlreadyExists();

        if (booking.appointmentDateTime.getTime() <= Date.now()) {
          throw new AppError(
            409,
            'APPOINTMENT_PASSED',
            'A booking cannot be paid after its appointment time',
          );
        }

        // Instant mock call. A real gateway call would not be made while holding a database lock.
        const charge = mockPaymentProvider.charge({
          amountPaise: booking.amountPaise,
          simulateOutcome: input.simulateOutcome,
        });

        const payment = await paymentRepository.create(tx, {
          bookingId: booking.id,
          amountPaise: booking.amountPaise,
          status: 'PENDING',
          providerPaymentId: charge.providerPaymentId,
        });

        if (charge.status === 'PENDING') {
          return { ...payment, booking: { id: booking.id, status: booking.status } };
        }

        const result = await settlePayment(tx, booking, payment, charge.status);
        return {
          ...payment,
          status: result.paymentStatus,
          booking: { id: booking.id, status: result.bookingStatus },
        };
      });
    } catch (err) {
      // Unique booking_id: the database's own guarantee of one payment per booking.
      if (isUniqueViolation(err)) throw paymentAlreadyExists();
      throw err;
    }
  },
};
