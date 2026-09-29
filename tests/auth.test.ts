import request from 'supertest';
import { createApp } from '../src/app';
import { userRepository } from '../src/repositories/user.repository';
import { verifyAccessToken } from '../src/utils/jwt';
import { prisma, resetDatabase } from './helpers/db';

const app = createApp();

const validUser = { name: 'Asha Rao', email: 'asha@example.com', password: 'password123' };

beforeEach(resetDatabase);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

describe('POST /auth/signup', () => {
  it('creates a user and never returns the password hash', async () => {
    const res = await request(app).post('/auth/signup').send(validUser);

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
    const res = await request(app)
      .post('/auth/signup')
      .send({ ...validUser, role: 'ADMIN' });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('USER');

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: validUser.email } });
    expect(stored.role).toBe('USER');
  });

  it('stores a bcrypt hash, not the plaintext password', async () => {
    await request(app).post('/auth/signup').send(validUser);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: validUser.email } });
    expect(stored.passwordHash).not.toBe(validUser.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$10\$/);
  });

  it('normalises the email to lowercase', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ ...validUser, email: '  Asha@Example.COM ' });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('asha@example.com');
  });

  it('rejects a duplicate email, regardless of case', async () => {
    await request(app).post('/auth/signup').send(validUser);
    const res = await request(app)
      .post('/auth/signup')
      .send({ ...validUser, email: 'ASHA@example.com' });

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
    const res = await request(app).post('/auth/signup').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/auth/signup').send(validUser);
  });

  it('returns a valid JWT for correct credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: validUser.email, password: validUser.password });

    expect(res.status).toBe(200);
    expect(res.body.data.tokenType).toBe('Bearer');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');

    const authUser = verifyAccessToken(res.body.data.accessToken);
    expect(authUser).toEqual({ id: res.body.data.user.id, email: validUser.email, role: 'USER' });
  });

  it('returns 401 for a wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: validUser.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the same 401 for an unknown email (no user enumeration)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: validUser.password });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('returns 400 for an invalid body', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('bcrypt 72-byte password limit', () => {
  it('rejects a signup password over 72 bytes even when it is under 72 characters', async () => {
    const password = 'é'.repeat(37); // 37 characters, 74 bytes

    const res = await request(app)
      .post('/auth/signup')
      .send({ ...validUser, password });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a password of exactly 72 bytes', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ ...validUser, password: 'é'.repeat(36) }); // 72 bytes

    expect(res.status).toBe(201);
  });

  it('rejects a login password over 72 bytes (so a correct prefix plus extra bytes cannot match)', async () => {
    await request(app).post('/auth/signup').send(validUser);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: validUser.email, password: validUser.password + 'x'.repeat(80) });

    expect(res.status).toBe(400);
  });
});

describe('concurrent signup race', () => {
  it('returns 409 when the email is taken between the existence check and the insert', async () => {
    await request(app).post('/auth/signup').send(validUser);
    // Open the race window: pretend the first check saw no user, so the INSERT runs and the
    // database unique constraint on email is what rejects it.
    jest.spyOn(userRepository, 'existsByEmail').mockResolvedValueOnce(false);

    const res = await request(app).post('/auth/signup').send(validUser);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(await prisma.user.count()).toBe(1);
  });
});
