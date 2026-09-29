import { prisma } from '../../src/config/prisma';

/** Empties every table so each test starts from a clean database. */
export const resetDatabase = () =>
  prisma.$executeRawUnsafe(
    'TRUNCATE TABLE webhook_events, payments, bookings, centre_tests, diagnostic_tests, diagnostic_centres, users CASCADE',
  );

export { prisma };
