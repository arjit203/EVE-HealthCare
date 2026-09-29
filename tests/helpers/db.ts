import { prisma } from '../../src/config/prisma';

/** Empties every table so each test starts from a clean database. */
export const resetDatabase = () =>
  prisma.$executeRawUnsafe(
    'TRUNCATE TABLE payment_events, payments, bookings, centre_test_offerings, diagnostic_tests, diagnostic_centres, users CASCADE',
  );

export { prisma };
