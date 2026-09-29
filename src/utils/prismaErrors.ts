import { Prisma } from '@prisma/client';

/** True when a write failed because it would break a UNIQUE constraint (Prisma code P2002). */
export const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
