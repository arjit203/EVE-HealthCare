/**
 * Foundation: app wiring, the central error handler and environment validation.
 * No database needed.
 */
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../src/app';
import { envSchema } from '../src/config/env';
import { errorHandler } from '../src/middleware/errorHandler';
import { logger } from '../src/utils/logger';

const app = createApp();

afterEach(() => jest.restoreAllMocks());

describe('app', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });

  it('returns a consistent JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns a JSON 404 for an unknown method on a known path', async () => {
    const res = await request(app).delete('/centres');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 (not 500) for a body over the 100kb limit', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(200 * 1024) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 415 (not 500) for an unsupported body encoding', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'bogus')
      .send('{}');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('does not advertise the framework in an X-Powered-By header', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('error handler', () => {
  // Prisma's real messages name tables, columns and constraints — exactly what must not leak.
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError(
      'Invalid `prisma.user.create()` invocation: constraint "users_email_key" on table "users"',
      { code, clientVersion: 'test' },
    );

  const appThrowing = (err: unknown) => {
    const failing = express();
    failing.get('/boom', () => {
      throw err;
    });
    failing.use(errorHandler);
    return failing;
  };

  const INTERNALS = /users_email_key|table|prisma|invocation|stack|at Object|SELECT|password_hash/i;

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

describe('environment validation', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/x',
    JWT_SECRET: 'a-secret-that-is-long-enough',
    WEBHOOK_SECRET: 'webhook-secret',
  };

  it.each(['3600', '15m', '1h', '7d'])('accepts JWT_EXPIRES_IN=%s', (value) => {
    expect(envSchema.safeParse({ ...base, JWT_EXPIRES_IN: value }).success).toBe(true);
  });

  it.each(['abc', '1 hour', '-5m', ''])('rejects JWT_EXPIRES_IN=%s at startup', (value) => {
    expect(envSchema.safeParse({ ...base, JWT_EXPIRES_IN: value }).success).toBe(false);
  });

  it('has no fallback secrets: a missing JWT_SECRET or WEBHOOK_SECRET is rejected', () => {
    expect(envSchema.safeParse({ ...base, JWT_SECRET: undefined }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, WEBHOOK_SECRET: undefined }).success).toBe(false);
  });
});
