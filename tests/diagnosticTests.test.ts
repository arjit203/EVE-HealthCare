import request from 'supertest';
import { createApp } from '../src/app';
import { createUserWithToken } from './helpers/auth';
import { prisma, resetDatabase } from './helpers/db';

const app = createApp();

let adminAuth: string;
let userAuth: string;

beforeEach(async () => {
  await resetDatabase();
  adminAuth = (await createUserWithToken('ADMIN')).auth;
  userAuth = (await createUserWithToken('USER')).auth;
});
afterAll(() => prisma.$disconnect());

const cbc = { name: 'Complete Blood Count', description: 'Blood cell counts' };

describe('POST /tests', () => {
  it('lets an admin create a test (201)', async () => {
    const res = await request(app).post('/tests').set('Authorization', adminAuth).send(cbc);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject(cbc);
    expect(res.body.data.id).toEqual(expect.any(String));
  });

  it('allows the description to be omitted', async () => {
    const res = await request(app)
      .post('/tests')
      .set('Authorization', adminAuth)
      .send({ name: 'HbA1c' });

    expect(res.status).toBe(201);
    expect(res.body.data.description).toBeNull();
  });

  it('returns 409 for a duplicate test name', async () => {
    await request(app).post('/tests').set('Authorization', adminAuth).send(cbc);
    const res = await request(app).post('/tests').set('Authorization', adminAuth).send(cbc);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 403 for a normal user', async () => {
    const res = await request(app).post('/tests').set('Authorization', userAuth).send(cbc);

    expect(res.status).toBe(403);
    expect(await prisma.diagnosticTest.count()).toBe(0);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/tests').send(cbc);

    expect(res.status).toBe(401);
  });

  it('returns 400 for a missing name', async () => {
    const res = await request(app)
      .post('/tests')
      .set('Authorization', adminAuth)
      .send({ description: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /tests', () => {
  it('is public and lists all tests', async () => {
    await request(app).post('/tests').set('Authorization', adminAuth).send(cbc);
    await request(app).post('/tests').set('Authorization', adminAuth).send({ name: 'HbA1c' });

    const res = await request(app).get('/tests');

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { name: string }) => t.name)).toEqual([
      'Complete Blood Count',
      'HbA1c',
    ]);
  });
});
