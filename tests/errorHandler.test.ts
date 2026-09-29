import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler';
import { logger } from '../src/utils/logger';

// Prisma's real messages name tables, columns and constraints — exactly what must not leak.
const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(
    'Invalid `prisma.user.create()` invocation: constraint "users_email_key" on table "users"',
    { code, clientVersion: 'test' },
  );

const appThrowing = (err: unknown) => {
  const app = express();
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
};

const INTERNALS = /users_email_key|table|prisma|invocation|stack|at Object|SELECT|password_hash/i;

afterEach(() => jest.restoreAllMocks());

describe('errorHandler', () => {
  it.each([
    ['P2002 (unique violation)', 'P2002', 409, 'CONFLICT'],
    ['P2025 (record not found)', 'P2025', 404, 'NOT_FOUND'],
    ['P2003 (foreign key violation)', 'P2003', 404, 'NOT_FOUND'],
  ])('maps Prisma %s to a generic response', async (_label, code, status, errorCode) => {
    const res = await request(appThrowing(prismaError(code))).get('/boom');

    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(errorCode);
    expect(JSON.stringify(res.body)).not.toMatch(INTERNALS);
  });

  it('returns a generic 500 for an unknown Prisma error code', async () => {
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    const res = await request(appThrowing(prismaError('P1001'))).get('/boom');

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(INTERNALS);
  });

  it('returns a generic 500 for an unexpected error, and sends details only to the log', async () => {
    const logError = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const err = new Error('SELECT password_hash FROM users failed at Object.<anonymous>');

    const res = await request(appThrowing(err)).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong' },
    });
    expect(logError).toHaveBeenCalledWith(
      'Unhandled error',
      expect.objectContaining({
        error: expect.objectContaining({ message: err.message, stack: expect.any(String) }),
      }),
    );
  });
});
