import type { PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { bookingRepository, type LockedBooking } from '../repositories/booking.repository';
import { AppError } from '../utils/AppError';
import { BOOKING_STATUS_FOR_PAYMENT, canTransition } from '../utils/bookingStatus';
import { isUniqueViolation } from '../utils/prismaErrors';
import type { CreatePaymentInput } from '../validators/payment.validator';
import { mockPaymentProvider } from './mockPaymentProvider';

const paymentAlreadyExists = () =>
  new AppError(409, 'PAYMENT_ALREADY_EXISTS', 'This booking has already been paid for');

/**
 * Records a provider result and moves the booking to CONFIRMED or FAILED, following the booking
 * state machine. Must run inside a transaction that holds the booking's row lock.
 * The payment webhook (module 5) settles through this same function.
 */
const settlePayment = async (
  tx: Prisma.TransactionClient,
  booking: LockedBooking,
  result: { providerPaymentId: string; status: PaymentStatus },
) => {
  const payment = await tx.payment.create({
    data: {
      bookingId: booking.id,
      amountPaise: booking.amountPaise,
      status: result.status,
      providerPaymentId: result.providerPaymentId,
    },
  });

  const bookingStatus = BOOKING_STATUS_FOR_PAYMENT[result.status];
  await tx.booking.update({ where: { id: booking.id }, data: { status: bookingStatus } });

  return { ...payment, booking: { id: booking.id, status: bookingStatus } };
};

export const paymentService = {
  /**
   * Pays for one of the user's PENDING bookings with the mock provider. Everything happens in one
   * transaction with the booking row locked, so two concurrent payments (or a payment and a cancel)
   * cannot both succeed. A FAILED outcome is still a successful request: 201 with status FAILED.
   */
  async pay(userId: string, input: CreatePaymentInput) {
    try {
      return await prisma.$transaction(async (tx) => {
        const booking = await bookingRepository.lockForUser(tx, input.bookingId, userId);
        if (!booking) throw AppError.notFound('Booking');

        const target = BOOKING_STATUS_FOR_PAYMENT[input.simulateOutcome];
        if (!canTransition(booking.status, target)) {
          if (booking.status === 'CONFIRMED') throw paymentAlreadyExists();
          throw new AppError(
            409,
            'BOOKING_NOT_PAYABLE',
            `A ${booking.status} booking cannot be paid`,
          );
        }
        if (booking.appointmentDateTime.getTime() <= Date.now()) {
          throw new AppError(
            409,
            'APPOINTMENT_PASSED',
            'A booking cannot be paid after its appointment time',
          );
        }

        // Instant mock call. A real gateway call would not be made while holding a database lock.
        const result = mockPaymentProvider.charge({
          amountPaise: booking.amountPaise,
          simulateOutcome: input.simulateOutcome,
        });

        return settlePayment(tx, booking, result);
      });
    } catch (err) {
      // Unique booking_id: the database's own guarantee of one payment per booking.
      if (isUniqueViolation(err)) throw paymentAlreadyExists();
      throw err;
    }
  },
};
