import request from 'supertest';
import { createApp } from '../src/app';
import { createUserWithToken } from './helpers/auth';
import { prisma, resetDatabase } from './helpers/db';

const app = createApp();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

let adminAuth: string;
let userAuth: string;

beforeEach(async () => {
  await resetDatabase();
  adminAuth = (await createUserWithToken('ADMIN')).auth;
  userAuth = (await createUserWithToken('USER')).auth;
});
afterAll(() => prisma.$disconnect());

const createCentre = (body = { name: 'HealthFirst', location: 'Koramangala, Bengaluru' }) =>
  request(app).post('/centres').set('Authorization', adminAuth).send(body);

const createTest = (name = 'Complete Blood Count') =>
  request(app).post('/tests').set('Authorization', adminAuth).send({ name });

const addOffering = (centreId: string, body: object, auth = adminAuth) =>
  request(app).post(`/centres/${centreId}/tests`).set('Authorization', auth).send(body);

describe('POST /centres', () => {
  it('lets an admin create a centre (201)', async () => {
    const res = await createCentre();

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'HealthFirst',
      location: 'Koramangala, Bengaluru',
    });
  });

  it('returns 403 for a normal user', async () => {
    const res = await request(app)
      .post('/centres')
      .set('Authorization', userAuth)
      .send({ name: 'X', location: 'Y' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.diagnosticCentre.count()).toBe(0);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/centres').send({ name: 'X', location: 'Y' });

    expect(res.status).toBe(401);
  });

  it('returns 400 for a missing location', async () => {
    const res = await request(app)
      .post('/centres')
      .set('Authorization', adminAuth)
      .send({ name: 'X' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 for the same name at the same location', async () => {
    await createCentre();
    const res = await createCentre();

    expect(res.status).toBe(409);
  });

  it('allows the same name at a different location (another branch)', async () => {
    await createCentre();
    const res = await createCentre({ name: 'HealthFirst', location: 'Indiranagar, Bengaluru' });

    expect(res.status).toBe(201);
  });
});

describe('GET /centres and GET /centres/:centreId', () => {
  it('lists centres publicly', async () => {
    await createCentre();
    const res = await request(app).get('/centres');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns one centre by id', async () => {
    const centre = (await createCentre()).body.data;
    const res = await request(app).get(`/centres/${centre.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(centre.id);
  });

  it('returns 404 for an unknown centre', async () => {
    const res = await request(app).get(`/centres/${UNKNOWN_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for an invalid UUID', async () => {
    const res = await request(app).get('/centres/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /centres/:centreId/tests (add offering)', () => {
  it('lets an admin offer a test at a centre-specific price (201)', async () => {
    const centre = (await createCentre()).body.data;
    const test = (await createTest()).body.data;

    const res = await addOffering(centre.id, { testId: test.id, pricePaise: 35000 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      centreId: centre.id,
      pricePaise: 35000,
      test: { id: test.id, name: 'Complete Blood Count' },
    });
  });

  it('returns 409 when the centre already offers the test', async () => {
    const centre = (await createCentre()).body.data;
    const test = (await createTest()).body.data;
    await addOffering(centre.id, { testId: test.id, pricePaise: 35000 });

    const res = await addOffering(centre.id, { testId: test.id, pricePaise: 40000 });

    expect(res.status).toBe(409);
    expect(await prisma.centreTestOffering.count()).toBe(1);
  });

  it('returns 404 for a nonexistent test', async () => {
    const centre = (await createCentre()).body.data;

    const res = await addOffering(centre.id, { testId: UNKNOWN_ID, pricePaise: 35000 });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/test/i);
  });

  it('returns 404 for a nonexistent centre', async () => {
    const test = (await createTest()).body.data;

    const res = await addOffering(UNKNOWN_ID, { testId: test.id, pricePaise: 35000 });

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
    const centre = (await createCentre()).body.data;
    const test = (await createTest()).body.data;

    const res = await addOffering(centre.id, { testId: test.id, pricePaise });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an invalid testId', async () => {
    const centre = (await createCentre()).body.data;

    const res = await addOffering(centre.id, { testId: 'abc', pricePaise: 35000 });

    expect(res.status).toBe(400);
  });

  it('returns 403 for a normal user', async () => {
    const centre = (await createCentre()).body.data;
    const test = (await createTest()).body.data;

    const res = await addOffering(centre.id, { testId: test.id, pricePaise: 35000 }, userAuth);

    expect(res.status).toBe(403);
  });
});

describe('GET /centres/:centreId/tests', () => {
  it('returns each test with the price at that specific centre', async () => {
    const bengaluru = (await createCentre()).body.data;
    const mumbai = (await createCentre({ name: 'CityCare', location: 'Andheri, Mumbai' })).body
      .data;
    const cbc = (await createTest()).body.data;
    await addOffering(bengaluru.id, { testId: cbc.id, pricePaise: 35000 });
    await addOffering(mumbai.id, { testId: cbc.id, pricePaise: 42000 });

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
    const centre = (await createCentre()).body.data;
    const res = await request(app).get(`/centres/${centre.id}/tests`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns 404 for an unknown centre', async () => {
    const res = await request(app).get(`/centres/${UNKNOWN_ID}/tests`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /centres/:centreId/tests/:testId (update price)', () => {
  const setup = async () => {
    const centre = (await createCentre()).body.data;
    const test = (await createTest()).body.data;
    await addOffering(centre.id, { testId: test.id, pricePaise: 35000 });
    return { centre, test, url: `/centres/${centre.id}/tests/${test.id}` };
  };

  it('lets an admin change the price', async () => {
    const { centre, url } = await setup();

    const res = await request(app)
      .patch(url)
      .set('Authorization', adminAuth)
      .send({ pricePaise: 39900 });

    expect(res.status).toBe(200);
    expect(res.body.data.pricePaise).toBe(39900);

    const list = await request(app).get(`/centres/${centre.id}/tests`);
    expect(list.body.data[0].pricePaise).toBe(39900);
  });

  it('returns 404 when the centre does not offer that test', async () => {
    const centre = (await createCentre()).body.data;
    const test = (await createTest()).body.data;

    const res = await request(app)
      .patch(`/centres/${centre.id}/tests/${test.id}`)
      .set('Authorization', adminAuth)
      .send({ pricePaise: 39900 });

    expect(res.status).toBe(404);
  });

  it('returns 400 for a negative price', async () => {
    const { url } = await setup();

    const res = await request(app)
      .patch(url)
      .set('Authorization', adminAuth)
      .send({ pricePaise: -1 });

    expect(res.status).toBe(400);
  });

  it('returns 403 for a normal user and leaves the price unchanged', async () => {
    const { url } = await setup();

    const res = await request(app)
      .patch(url)
      .set('Authorization', userAuth)
      .send({ pricePaise: 1 });

    expect(res.status).toBe(403);
    expect((await prisma.centreTestOffering.findFirstOrThrow()).pricePaise).toBe(35000);
  });
});

describe('database constraints (defence in depth)', () => {
  it('rejects a non-positive price even if application validation is bypassed', async () => {
    const centre = (await createCentre()).body.data;
    const test = (await createTest()).body.data;

    await expect(
      prisma.centreTestOffering.create({
        data: { centreId: centre.id, testId: test.id, pricePaise: -500 },
      }),
    ).rejects.toThrow(/centre_test_offerings_price_paise_positive/);
  });
});
