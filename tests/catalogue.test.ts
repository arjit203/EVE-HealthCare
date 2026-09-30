/**
 * Module 2 — Diagnostic centres, tests and offerings (a test offered by a centre at a price).
 * Creation goes through the API here, because creating these is what is under test.
 */
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, resetDatabase } from './helpers/db';
import { createUser } from './helpers/factories';

const app = createApp();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

let adminAuth: string;
let userAuth: string;

beforeEach(async () => {
  await resetDatabase();
  adminAuth = (await createUser('ADMIN')).auth;
  userAuth = (await createUser('USER')).auth;
});
afterAll(() => prisma.$disconnect());

const postCentre = (
  body: object = { name: 'HealthFirst', location: 'Koramangala, Bengaluru' },
  auth = adminAuth,
) => request(app).post('/centres').set('Authorization', auth).send(body);

const postTest = (body: object = { name: 'Complete Blood Count' }, auth = adminAuth) =>
  request(app).post('/tests').set('Authorization', auth).send(body);

const postOffering = (centreId: string, body: object, auth = adminAuth) =>
  request(app).post(`/centres/${centreId}/tests`).set('Authorization', auth).send(body);

/** A centre and a test created through the API, not yet linked. */
const centreAndTest = async () => ({
  centre: (await postCentre()).body.data,
  test: (await postTest()).body.data,
});

describe('POST /centres', () => {
  it('lets an admin create a centre (201)', async () => {
    const res = await postCentre();

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'HealthFirst',
      location: 'Koramangala, Bengaluru',
    });
  });

  it('returns 403 for a normal user and creates nothing', async () => {
    const res = await postCentre({ name: 'X', location: 'Y' }, userAuth);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.diagnosticCentre.count()).toBe(0);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/centres').send({ name: 'X', location: 'Y' });

    expect(res.status).toBe(401);
  });

  it('returns 400 for a missing location', async () => {
    const res = await postCentre({ name: 'X' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 for the same name at the same location', async () => {
    await postCentre();

    const res = await postCentre();

    expect(res.status).toBe(409);
  });

  it('allows the same name at a different location (another branch)', async () => {
    await postCentre();

    const res = await postCentre({ name: 'HealthFirst', location: 'Indiranagar, Bengaluru' });

    expect(res.status).toBe(201);
  });
});

describe('GET /centres and GET /centres/:centreId', () => {
  it('lists centres publicly', async () => {
    await postCentre();

    const res = await request(app).get('/centres');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns one centre by id', async () => {
    const centre = (await postCentre()).body.data;

    const res = await request(app).get(`/centres/${centre.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(centre.id);
  });

  it('returns 404 for an unknown centre', async () => {
    const res = await request(app).get(`/centres/${UNKNOWN_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed UUID', async () => {
    const res = await request(app).get('/centres/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /tests and GET /tests', () => {
  const cbc = { name: 'Complete Blood Count', description: 'Blood cell counts' };

  it('lets an admin create a test (201)', async () => {
    const res = await postTest(cbc);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject(cbc);
    expect(res.body.data.id).toEqual(expect.any(String));
  });

  it('allows the description to be omitted', async () => {
    const res = await postTest({ name: 'HbA1c' });

    expect(res.status).toBe(201);
    expect(res.body.data.description).toBeNull();
  });

  it('returns 409 for a duplicate test name', async () => {
    await postTest(cbc);

    const res = await postTest(cbc);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 403 for a normal user and creates nothing', async () => {
    const res = await postTest(cbc, userAuth);

    expect(res.status).toBe(403);
    expect(await prisma.diagnosticTest.count()).toBe(0);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/tests').send(cbc);

    expect(res.status).toBe(401);
  });

  it('returns 400 for a missing name', async () => {
    const res = await postTest({ description: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists all tests publicly', async () => {
    await postTest(cbc);
    await postTest({ name: 'HbA1c' });

    const res = await request(app).get('/tests');

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { name: string }) => t.name)).toEqual([
      'Complete Blood Count',
      'HbA1c',
    ]);
  });
});

describe('POST /centres/:centreId/tests (offer a test at a centre)', () => {
  it('lets an admin offer a test at a centre-specific price (201)', async () => {
    const { centre, test } = await centreAndTest();

    const res = await postOffering(centre.id, { testId: test.id, pricePaise: 35000 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      centreId: centre.id,
      pricePaise: 35000,
      test: { id: test.id, name: 'Complete Blood Count' },
    });
  });

  it('returns 409 when the centre already offers the test', async () => {
    const { centre, test } = await centreAndTest();
    await postOffering(centre.id, { testId: test.id, pricePaise: 35000 });

    const res = await postOffering(centre.id, { testId: test.id, pricePaise: 40000 });

    expect(res.status).toBe(409);
    expect(await prisma.centreTestOffering.count()).toBe(1);
  });

  it('returns 404 for a nonexistent test', async () => {
    const centre = (await postCentre()).body.data;

    const res = await postOffering(centre.id, { testId: UNKNOWN_ID, pricePaise: 35000 });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/test/i);
  });

  it('returns 404 for a nonexistent centre', async () => {
    const test = (await postTest()).body.data;

    const res = await postOffering(UNKNOWN_ID, { testId: test.id, pricePaise: 35000 });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/centre/i);
  });

  it.each([
    ['negative', -100],
    ['zero', 0],
    ['fractional', 350.5],
    ['a string', '35000'],
    ['above the maximum', 10_000_001],
  ])('returns 400 when pricePaise is %s', async (_label, pricePaise) => {
    const { centre, test } = await centreAndTest();

    const res = await postOffering(centre.id, { testId: test.id, pricePaise });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a malformed testId', async () => {
    const centre = (await postCentre()).body.data;

    const res = await postOffering(centre.id, { testId: 'abc', pricePaise: 35000 });

    expect(res.status).toBe(400);
  });

  it('returns 403 for a normal user', async () => {
    const { centre, test } = await centreAndTest();

    const res = await postOffering(centre.id, { testId: test.id, pricePaise: 35000 }, userAuth);

    expect(res.status).toBe(403);
  });
});

describe('GET /centres/:centreId/tests', () => {
  it('returns each test with the price at that specific centre', async () => {
    const bengaluru = (await postCentre()).body.data;
    const mumbai = (await postCentre({ name: 'CityCare', location: 'Andheri, Mumbai' })).body.data;
    const cbc = (await postTest()).body.data;
    await postOffering(bengaluru.id, { testId: cbc.id, pricePaise: 35000 });
    await postOffering(mumbai.id, { testId: cbc.id, pricePaise: 42000 });

    const bengaluruRes = await request(app).get(`/centres/${bengaluru.id}/tests`);
    const mumbaiRes = await request(app).get(`/centres/${mumbai.id}/tests`);

    expect(bengaluruRes.status).toBe(200);
    expect(bengaluruRes.body.data).toEqual([
      expect.objectContaining({ pricePaise: 35000, test: expect.objectContaining({ id: cbc.id }) }),
    ]);
    expect(mumbaiRes.body.data).toEqual([
      expect.objectContaining({ pricePaise: 42000, test: expect.objectContaining({ id: cbc.id }) }),
    ]);
  });

  it('returns an empty list for a centre with no tests', async () => {
    const centre = (await postCentre()).body.data;

    const res = await request(app).get(`/centres/${centre.id}/tests`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns 404 for an unknown centre', async () => {
    const res = await request(app).get(`/centres/${UNKNOWN_ID}/tests`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /centres/:centreId/tests/:testId (change the price)', () => {
  const offered = async () => {
    const { centre, test } = await centreAndTest();
    await postOffering(centre.id, { testId: test.id, pricePaise: 35000 });
    return { centre, url: `/centres/${centre.id}/tests/${test.id}` };
  };
  const patchPrice = (url: string, pricePaise: number, auth = adminAuth) =>
    request(app).patch(url).set('Authorization', auth).send({ pricePaise });

  it('lets an admin change the price', async () => {
    const { centre, url } = await offered();

    const res = await patchPrice(url, 39900);

    expect(res.status).toBe(200);
    expect(res.body.data.pricePaise).toBe(39900);
    const list = await request(app).get(`/centres/${centre.id}/tests`);
    expect(list.body.data[0].pricePaise).toBe(39900);
  });

  it('returns 404 when the centre does not offer that test', async () => {
    const { centre, test } = await centreAndTest();

    const res = await patchPrice(`/centres/${centre.id}/tests/${test.id}`, 39900);

    expect(res.status).toBe(404);
  });

  it('returns 400 for a negative price', async () => {
    const { url } = await offered();

    const res = await patchPrice(url, -1);

    expect(res.status).toBe(400);
  });

  it('returns 403 for a normal user and leaves the price unchanged', async () => {
    const { url } = await offered();

    const res = await patchPrice(url, 1, userAuth);

    expect(res.status).toBe(403);
    expect((await prisma.centreTestOffering.findFirstOrThrow()).pricePaise).toBe(35000);
  });
});

describe('database constraints (defence in depth)', () => {
  it('rejects a non-positive price even if application validation is bypassed', async () => {
    const { centre, test } = await centreAndTest();

    await expect(
      prisma.centreTestOffering.create({
        data: { centreId: centre.id, testId: test.id, pricePaise: -500 },
      }),
    ).rejects.toThrow(/centre_test_offerings_price_paise_positive/);
  });
});
