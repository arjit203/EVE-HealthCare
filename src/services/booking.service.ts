import { bookingRepository } from '../repositories/booking.repository';
import { centreRepository } from '../repositories/centre.repository';
import { diagnosticTestRepository } from '../repositories/diagnosticTest.repository';
import { offeringRepository } from '../repositories/offering.repository';
import { AppError } from '../utils/AppError';
import { canTransition, statusesThatCanBecome } from '../utils/bookingStatus';
import { isUniqueViolation } from '../utils/prismaErrors';
import type { CreateBookingInput } from '../validators/booking.validator';

type BookingWithRelations = NonNullable<Awaited<ReturnType<typeof bookingRepository.create>>>;

/** API shape: flattens offering.centre / offering.test into centre / test. */
const toBookingResponse = ({ offering, userId: _userId, ...booking }: BookingWithRelations) => ({
  ...booking,
  centre: offering.centre,
  test: offering.test,
});

const bookingNotFound = () => AppError.notFound('Booking');

export const bookingService = {
  async create(userId: string, input: CreateBookingInput) {
    const { centreId, testId, appointmentDateTime } = input;

    const offering = await offeringRepository.findByCentreAndTest(centreId, testId);
    if (!offering) {
      // Work out which rule failed, so the client gets a precise error.
      if (!(await centreRepository.findById(centreId))) {
        throw AppError.notFound('Diagnostic centre');
      }
      if (!(await diagnosticTestRepository.findById(testId))) {
        throw AppError.notFound('Diagnostic test');
      }
      throw new AppError(422, 'TEST_NOT_OFFERED', 'This centre does not offer the selected test');
    }

    try {
      const booking = await bookingRepository.create({
        userId,
        centreId,
        testId,
        appointmentDateTime,
        // The amount always comes from the server-side price, never from the request.
        amountPaise: offering.pricePaise,
      });
      return toBookingResponse(booking);
    } catch (err) {
      // Partial unique index bookings_no_duplicate_active.
      if (isUniqueViolation(err)) {
        throw new AppError(
          409,
          'DUPLICATE_BOOKING',
          'You already have an active booking for this test at this centre and time',
        );
      }
      throw err;
    }
  },

  async listForUser(userId: string) {
    const bookings = await bookingRepository.findAllForUser(userId);
    return bookings.map(toBookingResponse);
  },

  async getForUser(userId: string, bookingId: string) {
    const booking = await bookingRepository.findByIdForUser(bookingId, userId);
    if (!booking) throw bookingNotFound();
    return toBookingResponse(booking);
  },

  async cancel(userId: string, bookingId: string) {
    const now = new Date();
    const changed = await bookingRepository.transitionForUser(
      bookingId,
      userId,
      statusesThatCanBecome('CANCELLED'),
      'CANCELLED',
      now,
    );

    const booking = await bookingRepository.findByIdForUser(bookingId, userId);
    if (!booking) throw bookingNotFound();
    if (changed === 1) return toBookingResponse(booking);

    // Nothing changed: explain why.
    if (!canTransition(booking.status, 'CANCELLED')) {
      throw new AppError(
        409,
        'INVALID_STATUS_TRANSITION',
        `A ${booking.status} booking cannot be cancelled`,
      );
    }
    throw new AppError(
      409,
      'APPOINTMENT_PASSED',
      'A booking cannot be cancelled after its appointment time',
    );
  },
};
