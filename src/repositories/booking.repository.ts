import type { BookingStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

// Every booking is returned with the centre and test it is for, and its payment (if any).
const withCentreAndTest = {
  offering: {
    select: {
      centre: { select: { id: true, name: true, location: true } },
      test: { select: { id: true, name: true } },
    },
  },
  payment: {
    select: { id: true, status: true, providerPaymentId: true, amountPaise: true, createdAt: true },
  },
} as const;

export interface LockedBooking {
  id: string;
  status: BookingStatus;
  amountPaise: number;
  appointmentDateTime: Date;
}

export const bookingRepository = {
  create(data: {
    userId: string;
    centreId: string;
    testId: string;
    appointmentDateTime: Date;
    amountPaise: number;
  }) {
    return prisma.booking.create({ data, include: withCentreAndTest });
  },

  findAllForUser(userId: string) {
    return prisma.booking.findMany({
      where: { userId },
      include: withCentreAndTest,
      orderBy: { createdAt: 'desc' },
    });
  },

  // Always filtered by owner: another user's booking is indistinguishable from a missing one.
  findByIdForUser(id: string, userId: string) {
    return prisma.booking.findFirst({ where: { id, userId }, include: withCentreAndTest });
  },

  /**
   * Atomically moves a booking to `to`, but only if it belongs to the user, is currently in one of
   * `from`, and its appointment is still in the future. Returns the number of rows changed (0 or 1).
   * Check-and-update happen in one SQL statement, so a concurrent update cannot slip in between.
   */
  async transitionForUser(
    id: string,
    userId: string,
    from: BookingStatus[],
    to: BookingStatus,
    now: Date,
  ) {
    const { count } = await prisma.booking.updateMany({
      where: { id, userId, status: { in: from }, appointmentDateTime: { gt: now } },
      data: { status: to },
    });
    return count;
  },

  /**
   * Inside a transaction: reads the user's booking and LOCKS its row (SELECT … FOR UPDATE) until the
   * transaction ends. Any other transaction that wants to change this booking (a second payment, a
   * cancel) waits, then sees the updated status. Returns null if not found or not the user's.
   */
  async lockForUser(tx: Prisma.TransactionClient, id: string, userId: string) {
    const rows = await tx.$queryRaw<LockedBooking[]>`
      SELECT id, status, amount_paise AS "amountPaise", appointment_date_time AS "appointmentDateTime"
      FROM bookings
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
      FOR UPDATE`;
    return rows[0] ?? null;
  },
};
