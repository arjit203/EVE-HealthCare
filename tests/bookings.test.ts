import request from 'supertest';
import { createApp } from '../src/app';
import { createUserWithToken } from './helpers/auth';
import { prisma, resetDatabase } from './helpers/db';

const app = createApp();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const DAY = 24 * 60 * 60 * 1000;
const futureIso = (days = 7) => new Date(Date.now() + days * DAY).toISOString();

let alice: { auth: string; userId: string };
let bob: { auth: string; userId: string };
let adminAuth: string;
let centreId: string;
let otherCentreId: string;
let cbcId: string;
let mriId: string;

beforeEach(async () => {
  await resetDatabase();
  const a = await createUserWithToken('USER');
  const b = await createUserWithToken('USER');
  alice = { auth: a.auth, userId: a.user.id };
  bob = { auth: b.auth, userId: b.user.id };
  adminAuth = (await createUserWithToken('ADMIN')).auth;

  const centre = await prisma.diagnosticCentre.create({
    data: { name: 'HealthFirst', location: 'Koramangala, Bengaluru' },
  });
  const otherCentre = await prisma.diagnosticCentre.create({
    data: { name: 'CityCare', location: 'Andheri, Mumbai' },
  });
  const cbc = await prisma.diagnosticTest.create({ data: { name: 'CBC' } });
  const mri = await prisma.diagnosticTest.create({ data: { name: 'MRI Brain' } });
  // HealthFirst offers only CBC; CityCare offers CBC and MRI.
  await prisma.centreTestOffering.createMany({
    data: [
      { centreId: centre.id, testId: cbc.id, pricePaise: 35000 },
      { centreId: otherCentre.id, testId: cbc.id, pricePaise: 42000 },
      { centreId: otherCentre.id, testId: mri.id, pricePaise: 750000 },
    ],
  });
  centreId = centre.id;
  otherCentreId = otherCentre.id;
  cbcId = cbc.id;
  mriId = mri.id;
});
afterAll(() => prisma.$disconnect());

const book = (body: object, auth = alice.auth) =>
  request(app).post('/bookings').set('Authorization', auth).send(body);

const validBody = () => ({ centreId, testId: cbcId, appointmentDateTime: futureIso() });

const createBooking = async (auth = alice.auth, body: object = validBody()) => {
  const res = await book(body, auth);
  expect(res.status).toBe(201);
  return res.body.data;
};

describe('POST /bookings', () => {
  it('creates a PENDING booking priced from the offering', async () => {
    const res = await book(validBody());

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      amountPaise: 35000,
      centreId,
      testId: cbcId,
      centre: { id: centreId, name: 'HealthFirst' },
      test: { id: cbcId, name: 'CBC' },
    });
    expect(res.body.data).not.toHaveProperty('userId');

    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.userId).toBe(alice.userId);
  });

  it('uses the price of the chosen centre', async () => {
    const res = await book({ ...validBody(), centreId: otherCentreId });

    expect(res.body.data.amountPaise).toBe(42000);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/bookings').send(validBody());

    expect(res.status).toBe(401);
    expect(await prisma.booking.count()).toBe(0);
  });

  it('returns 404 for a nonexistent centre', async () => {
    const res = await book({ ...validBody(), centreId: UNKNOWN_ID });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/centre/i);
  });

  it('returns 404 for a nonexistent test', async () => {
    const res = await book({ ...validBody(), testId: UNKNOWN_ID });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/test/i);
  });

  it('returns 422 when the centre does not offer the test', async () => {
    const res = await book({ ...validBody(), testId: mriId }); // HealthFirst has no MRI

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TEST_NOT_OFFERED');
    expect(await prisma.booking.count()).toBe(0);
  });

  it('rejects a client-supplied amount with 400', async () => {
    const res = await book({ ...validBody(), amountPaise: 1 });
    const res2 = await book({ ...validBody(), amount: 1 });

    expect(res.status).toBe(400);
    expect(res2.status).toBe(400);
    expect(await prisma.booking.count()).toBe(0);
  });

  it('rejects a client-supplied status with 400', async () => {
    const res = await book({ ...validBody(), status: 'CONFIRMED' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an appointment in the past', async () => {
    const res = await book({ ...validBody(), appointmentDateTime: futureIso(-1) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['without a timezone', '2030-01-15T10:00:00'],
    ['that is not a date', 'next tuesday'],
  ])('returns 400 for an appointment time %s', async (_label, appointmentDateTime) => {
    const res = await book({ ...validBody(), appointmentDateTime });

    expect(res.status).toBe(400);
  });

  it('accepts a timezone offset and stores the correct instant', async () => {
    const res = await book({ ...validBody(), appointmentDateTime: '2030-01-15T10:00:00+05:30' });

    expect(res.status).toBe(201);
    expect(res.body.data.appointmentDateTime).toBe('2030-01-15T04:30:00.000Z');
  });

  it('returns 400 for malformed ids in the body', async () => {
    const res = await book({ ...validBody(), centreId: 'abc' });

    expect(res.status).toBe(400);
  });

  it('returns 409 for a duplicate active booking (double click)', async () => {
    const body = validBody();
    await createBooking(alice.auth, body);

    const res = await book(body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_BOOKING');
  });

  it('allows re-booking the same slot after cancelling', async () => {
    const body = validBody();
    const first = await createBooking(alice.auth, body);
    await request(app).patch(`/bookings/${first.id}/cancel`).set('Authorization', alice.auth);

    const res = await book(body);

    expect(res.status).toBe(201);
  });

  it('keeps the booked amount when an admin later changes the price', async () => {
    const booking = await createBooking();

    const patch = await request(app)
      .patch(`/centres/${centreId}/tests/${cbcId}`)
      .set('Authorization', adminAuth)
      .send({ pricePaise: 99900 });
    expect(patch.status).toBe(200);

    const res = await request(app).get(`/bookings/${booking.id}`).set('Authorization', alice.auth);
    expect(res.body.data.amountPaise).toBe(35000);

    const newBooking = await createBooking(alice.auth, {
      ...validBody(),
      appointmentDateTime: futureIso(8),
    });
    expect(newBooking.amountPaise).toBe(99900);
  });
});

describe('database guarantees (defence in depth)', () => {
  it('refuses a booking for a centre/test pair that is not offered', async () => {
    await expect(
      prisma.booking.create({
        data: {
          userId: alice.userId,
          centreId,
          testId: mriId, // not offered at this centre
          appointmentDateTime: new Date(Date.now() + DAY),
          amountPaise: 1000,
        },
      }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });
});

describe('GET /bookings', () => {
  it("returns only the caller's bookings, newest first", async () => {
    const older = await createBooking(alice.auth);
    const newer = await createBooking(alice.auth, {
      ...validBody(),
      appointmentDateTime: futureIso(9),
    });
    await createBooking(bob.auth);

    const res = await request(app).get('/bookings').set('Authorization', alice.auth);

    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { id: string }) => b.id)).toEqual([newer.id, older.id]);
  });

  it("does not show other users' bookings to an admin", async () => {
    await createBooking(bob.auth);

    const res = await request(app).get('/bookings').set('Authorization', adminAuth);

    expect(res.body.data).toEqual([]);
  });

  it('returns 401 without a token', async () => {
    expect((await request(app).get('/bookings')).status).toBe(401);
  });
});

describe('GET /bookings/:id', () => {
  it('returns the booking to its owner', async () => {
    const booking = await createBooking();

    const res = await request(app).get(`/bookings/${booking.id}`).set('Authorization', alice.auth);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(booking.id);
  });

  it("returns 404 (not 403) for another user's booking", async () => {
    const booking = await createBooking(alice.auth);

    const res = await request(app).get(`/bookings/${booking.id}`).set('Authorization', bob.auth);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a nonexistent booking', async () => {
    const res = await request(app).get(`/bookings/${UNKNOWN_ID}`).set('Authorization', alice.auth);

    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed booking id', async () => {
    const res = await request(app).get('/bookings/not-a-uuid').set('Authorization', alice.auth);

    expect(res.status).toBe(400);
  });
});

describe('PATCH /bookings/:id/cancel', () => {
  const cancel = (id: string, auth = alice.auth) =>
    request(app).patch(`/bookings/${id}/cancel`).set('Authorization', auth);

  it('cancels a PENDING booking', async () => {
    const booking = await createBooking();

    const res = await cancel(booking.id);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('cancels a CONFIRMED booking', async () => {
    const booking = await createBooking();
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } });

    const res = await cancel(booking.id);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('returns 409 when cancelling twice', async () => {
    const booking = await createBooking();
    await cancel(booking.id);

    const res = await cancel(booking.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns 409 when cancelling a FAILED booking', async () => {
    const booking = await createBooking();
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'FAILED' } });

    const res = await cancel(booking.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns 409 after the appointment time has passed', async () => {
    const booking = await createBooking();
    await prisma.booking.update({
      where: { id: booking.id },
      data: { appointmentDateTime: new Date(Date.now() - DAY) },
    });

    const res = await cancel(booking.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPOINTMENT_PASSED');
  });

  it("returns 404 for another user's booking and leaves it unchanged", async () => {
    const booking = await createBooking(alice.auth);

    const res = await cancel(booking.id, bob.auth);

    expect(res.status).toBe(404);
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(stored.status).toBe('PENDING');
  });

  it('returns 404 for a nonexistent booking', async () => {
    expect((await cancel(UNKNOWN_ID)).status).toBe(404);
  });

  it('returns 400 for a malformed booking id', async () => {
    expect((await cancel('123')).status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const booking = await createBooking();

    expect((await request(app).patch(`/bookings/${booking.id}/cancel`)).status).toBe(401);
  });

  it('lets exactly one of two concurrent cancels succeed', async () => {
    const booking = await createBooking();

    const results = await Promise.all([cancel(booking.id), cancel(booking.id)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});
