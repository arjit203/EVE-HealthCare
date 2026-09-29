import request from 'supertest';
import { seedAdmin, seedCatalogue } from '../prisma/seed';
import { createApp } from '../src/app';
import { verifyAccessToken } from '../src/utils/jwt';
import { prisma, resetDatabase } from './helpers/db';

const app = createApp();
const adminInput = { name: 'Admin', email: 'admin@eve.local', password: 'admin-password-1' };

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('seedAdmin', () => {
  it('creates an admin who can log in and receives an ADMIN token', async () => {
    await seedAdmin(adminInput);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: adminInput.email, password: adminInput.password });

    expect(res.status).toBe(200);
    expect(verifyAccessToken(res.body.data.accessToken).role).toBe('ADMIN');
  });

  it('is safe to run more than once', async () => {
    await seedAdmin(adminInput);
    await seedAdmin(adminInput);

    expect(await prisma.user.count({ where: { email: adminInput.email } })).toBe(1);
  });

  it('takes back the admin email if a normal user registered it first', async () => {
    await request(app)
      .post('/auth/signup')
      .send({ name: 'Intruder', email: adminInput.email, password: 'intruder-password' });

    await seedAdmin(adminInput);

    const intruderLogin = await request(app)
      .post('/auth/login')
      .send({ email: adminInput.email, password: 'intruder-password' });
    expect(intruderLogin.status).toBe(401);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: adminInput.email } });
    expect(stored.role).toBe('ADMIN');
  });
});

describe('seedCatalogue', () => {
  it('seeds the same test at different prices at different centres', async () => {
    await seedCatalogue();

    const cbcOfferings = await prisma.centreTestOffering.findMany({
      where: { test: { name: 'Complete Blood Count (CBC)' } },
    });
    const prices = new Set(cbcOfferings.map((o) => o.pricePaise));

    expect(cbcOfferings.length).toBeGreaterThan(1);
    expect(prices.size).toBe(cbcOfferings.length);
  });

  it('is safe to run more than once', async () => {
    const first = await seedCatalogue();
    await seedCatalogue();

    expect(await prisma.diagnosticCentre.count()).toBe(first.centres);
    expect(await prisma.diagnosticTest.count()).toBe(first.tests);
    expect(await prisma.centreTestOffering.count()).toBe(first.offerings);
  });
});
