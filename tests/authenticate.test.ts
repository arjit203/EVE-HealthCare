import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { authenticate } from '../src/middleware/authenticate';
import { requireAdmin } from '../src/middleware/requireAdmin';
import { errorHandler } from '../src/middleware/errorHandler';
import { signAccessToken } from '../src/utils/jwt';

// A minimal app with protected routes, so the middleware is tested in isolation
// (no database needed).
const app = express();
app.get('/protected', authenticate, (req, res) => {
  res.json({ data: req.user });
});
app.post('/admin-only', authenticate, requireAdmin, (_req, res) => {
  res.status(201).json({ data: { ok: true } });
});
app.use(errorHandler);

const user = {
  id: '7f3c2a1e-0000-4000-8000-000000000001',
  email: 'asha@example.com',
  role: 'USER' as const,
};
const admin = {
  id: '7f3c2a1e-0000-4000-8000-000000000002',
  email: 'admin@example.com',
  role: 'ADMIN' as const,
};
const secret = process.env.JWT_SECRET as string;

describe('authenticate middleware', () => {
  it('allows a request with a valid token and exposes req.user', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${signAccessToken(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(user);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(app).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when the scheme is not Bearer', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Basic ${signAccessToken(user)}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a malformed token', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer not.a.jwt');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for a token signed with a different secret', async () => {
    const forged = jwt.sign({ email: user.email }, 'some-other-secret-value', {
      subject: user.id,
    });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 TOKEN_EXPIRED for an expired token', async () => {
    const expired = jwt.sign({ email: user.email }, secret, {
      subject: user.id,
      expiresIn: -10,
    });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('token payload validation', () => {
  it('rejects a correctly signed token that has no valid role', async () => {
    const noRole = jwt.sign({ email: user.email }, secret, { subject: user.id });
    const badRole = jwt.sign({ email: user.email, role: 'SUPERUSER' }, secret, {
      subject: user.id,
    });

    for (const token of [noRole, badRole]) {
      const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    }
  });
});

describe('requireAdmin middleware', () => {
  it('returns 401 when no token is sent', async () => {
    const res = await request(app).post('/admin-only');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 for an authenticated normal user', async () => {
    const res = await request(app)
      .post('/admin-only')
      .set('Authorization', `Bearer ${signAccessToken(user)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin', async () => {
    const res = await request(app)
      .post('/admin-only')
      .set('Authorization', `Bearer ${signAccessToken(admin)}`);

    expect(res.status).toBe(201);
  });
});

describe('algorithm pinning', () => {
  it('rejects an unsigned "alg: none" token claiming ADMIN', async () => {
    const unsigned = jwt.sign({ email: admin.email, role: 'ADMIN' }, '', {
      algorithm: 'none',
      subject: admin.id,
    });

    const res = await request(app).post('/admin-only').set('Authorization', `Bearer ${unsigned}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});
