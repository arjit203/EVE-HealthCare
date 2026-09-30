/**
 * Authentication & authorization: signup, login, JWT middleware, admin check.
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app';
import { authenticate } from '../src/middleware/authenticate';
import { errorHandler } from '../src/middleware/errorHandler';
import { requireAdmin } from '../src/middleware/requireAdmin';
import { userRepository } from '../src/repositories/user.repository';
import { signAccessToken, verifyAccessToken } from '../src/utils/jwt';
import { prisma, resetDatabase } from './helpers/db';

const app = createApp();
const validUser = { name: 'Asha Rao', email: 'asha@example.com', password: 'password123' };
const signup = (body: object = validUser) => request(app).post('/auth/signup').send(body);
const login = (body: object) => request(app).post('/auth/login').send(body);

beforeEach(resetDatabase);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

describe('POST /auth/signup', () => {
  it('creates a USER and never returns the password hash', async () => {
    const res = await signup();

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Asha Rao',
      email: 'asha@example.com',
      role: 'USER',
    });
    expect(res.body.data.id).toEqual(expect.any(String));
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(res.body.data).not.toHaveProperty('password');
  });

  it('ignores a role in the request body, so nobody can sign up as ADMIN', async () => {
    const res = await signup({ ...validUser, role: 'ADMIN' });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('USER');
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: validUser.email } });
    expect(stored.role).toBe('USER');
  });

  it('stores a bcrypt hash, not the plaintext password', async () => {
    await signup();

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: validUser.email } });
    expect(stored.passwordHash).not.toBe(validUser.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$10\$/);
  });

  it('normalises the email to lowercase', async () => {
    const res = await signup({ ...validUser, email: '  Asha@Example.COM ' });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('asha@example.com');
  });

  it('returns 409 for a duplicate email, regardless of case', async () => {
    await signup();

    const res = await signup({ ...validUser, email: 'ASHA@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(await prisma.user.count()).toBe(1);
  });

  it('returns 409 when the email is taken between the existence check and the insert (race)', async () => {
    await signup();
    // Open the race window: pretend the first check saw no user, so the INSERT runs and the
    // database unique constraint on email is what rejects it.
    jest.spyOn(userRepository, 'existsByEmail').mockResolvedValueOnce(false);

    const res = await signup();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(await prisma.user.count()).toBe(1);
  });

  it.each([
    ['missing name', { email: 'a@example.com', password: 'password123' }],
    ['invalid email', { ...validUser, email: 'not-an-email' }],
    ['short password', { ...validUser, password: 'short' }],
    ['empty body', {}],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await signup(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a password over 72 bytes, even when it is under 72 characters', async () => {
    const res = await signup({ ...validUser, password: 'é'.repeat(37) }); // 37 chars, 74 bytes

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a password of exactly 72 bytes', async () => {
    const res = await signup({ ...validUser, password: 'é'.repeat(36) }); // 72 bytes

    expect(res.status).toBe(201);
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await signup();
  });

  it('returns a valid JWT for correct credentials', async () => {
    const res = await login({ email: validUser.email, password: validUser.password });

    expect(res.status).toBe(200);
    expect(res.body.data.tokenType).toBe('Bearer');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    const authUser = verifyAccessToken(res.body.data.accessToken);
    expect(authUser).toEqual({ id: res.body.data.user.id, email: validUser.email, role: 'USER' });
  });

  it('returns 401 for a wrong password', async () => {
    const res = await login({ email: validUser.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the same 401 for an unknown email (no user enumeration)', async () => {
    const res = await login({ email: 'nobody@example.com', password: validUser.password });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('returns 400 for an invalid body', async () => {
    const res = await login({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a password over 72 bytes (a correct prefix plus extra bytes cannot match)', async () => {
    const res = await login({
      email: validUser.email,
      password: validUser.password + 'x'.repeat(80),
    });

    expect(res.status).toBe(400);
  });
});

// The middleware is tested on a tiny app with protected routes, so no database is needed.
describe('protected routes (authenticate + requireAdmin middleware)', () => {
  const protectedApp = express();
  protectedApp.get('/protected', authenticate, (req, res) => {
    res.json({ data: req.user });
  });
  protectedApp.post('/admin-only', authenticate, requireAdmin, (_req, res) => {
    res.status(201).json({ data: { ok: true } });
  });
  protectedApp.use(errorHandler);

  const user = {
    id: '7f3c2a1e-0000-4000-8000-000000000001',
    email: 'u@example.com',
    role: 'USER' as const,
  };
  const admin = {
    id: '7f3c2a1e-0000-4000-8000-000000000002',
    email: 'a@example.com',
    role: 'ADMIN' as const,
  };
  const secret = process.env.JWT_SECRET as string;
  const getProtected = (authorization?: string) => {
    const req = request(protectedApp).get('/protected');
    return authorization ? req.set('Authorization', authorization) : req;
  };

  it('allows a request with a valid JWT and exposes the user from the token', async () => {
    const res = await getProtected(`Bearer ${signAccessToken(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(user);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await getProtected();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when the scheme is not Bearer', async () => {
    const res = await getProtected(`Basic ${signAccessToken(user)}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a malformed token', async () => {
    const res = await getProtected('Bearer not.a.jwt');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for a token signed with a different secret', async () => {
    const forged = jwt.sign({ email: user.email }, 'some-other-secret-value', { subject: user.id });

    const res = await getProtected(`Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 TOKEN_EXPIRED for an expired token', async () => {
    const expired = jwt.sign({ email: user.email }, secret, { subject: user.id, expiresIn: -10 });

    const res = await getProtected(`Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('returns 401 for a correctly signed token without a valid role', async () => {
    const noRole = jwt.sign({ email: user.email }, secret, { subject: user.id });
    const badRole = jwt.sign({ email: user.email, role: 'SUPERUSER' }, secret, {
      subject: user.id,
    });

    for (const token of [noRole, badRole]) {
      const res = await getProtected(`Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    }
  });

  it('returns 401 for an unsigned "alg: none" token claiming ADMIN (algorithm is pinned)', async () => {
    const unsigned = jwt.sign({ email: admin.email, role: 'ADMIN' }, '', {
      algorithm: 'none',
      subject: admin.id,
    });

    const res = await request(protectedApp)
      .post('/admin-only')
      .set('Authorization', `Bearer ${unsigned}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('admin-only route: returns 401 when no token is sent', async () => {
    const res = await request(protectedApp).post('/admin-only');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('admin-only route: returns 403 for an authenticated normal user', async () => {
    const res = await request(protectedApp)
      .post('/admin-only')
      .set('Authorization', `Bearer ${signAccessToken(user)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('admin-only route: allows an admin', async () => {
    const res = await request(protectedApp)
      .post('/admin-only')
      .set('Authorization', `Bearer ${signAccessToken(admin)}`);

    expect(res.status).toBe(201);
  });
});
