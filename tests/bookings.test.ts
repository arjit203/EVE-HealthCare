/**
 * Bookings: creation rules, ownership, cancellation and the booking state machine.
 */
import request from 'supertest';
import { createApp } from '../src/app';
import { canTransition, statusesThatCanBecome } from '../src/utils/bookingStatus';
import { prisma, resetDatabase } from './helpers/db';
import {
  createBookingFor,
  createCentre,
  createOffering,
  createTest,
  createUser,
  daysFromNow,
  nextAppointment,
} from './helpers/factories';

const app = createApp();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

let alice: { auth: string; userId: string };
let bob: { auth: string; userId: string };
let adminAuth: string;
let healthFirstId: string;
let cityCareId: string;
let cbcId: string;
let mriId: string;

beforeEach(async () => {
  await resetDatabase();
  const a = await createUser();
  const b = await createUser();
  alice = { auth: a.auth, userId: a.user.id };
  bob = { auth: b.auth, userId: b.user.id };
  adminAuth = (await createUser('ADMIN')).auth;

  // HealthFirst offers only CBC (₹350); CityCare offers CBC (₹420) and MRI.
  const healthFirst = await createCentre('HealthFirst');
  const cityCare = await createCentre('CityCare');
  const cbc = await createTest('CBC');
  const mri = await createTest('MRI Brain');
  await createOffering(healthFirst.id, cbc.id, 35000);
  await createOffering(cityCare.id, cbc.id, 42000);
  await createOffering(cityCare.id, mri.id, 750000);
  healthFirstId = healthFirst.id;
  cityCareId = cityCare.id;
  cbcId = cbc.id;
  mriId = mri.id;
});
afterAll(() => prisma.$disconnect());

const book = (body: object, auth = alice.auth) =>
  request(app).post('/bookings').set('Authorization', auth).send(body);

const cbcAtHealthFirst = () => ({
  centreId: healthFirstId,
  testId: cbcId,
  appointmentDateTime: nextAppointment(),
});

const bookCbc = (auth = alice.auth) =>
  createBookingFor(auth, { centreId: healthFirstId, testId: cbcId });

const getBooking = (id: string, auth = alice.auth) =>
  request(app).get(`/bookings/${id}`).set('Authorization', auth);

const cancel = (id: string, auth = alice.auth) =>
  request(app).patch(`/bookings/${id}/cancel`).set('Authorization', auth);

describe('booking state machine', () => {
  it.each([
    ['PENDING', 'CONFIRMED'],
    ['PENDING', 'FAILED'],
    ['PENDING', 'CANCELLED'],
    ['CONFIRMED', 'CANCELLED'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['CONFIRMED', 'PENDING'],
    ['CONFIRMED', 'FAILED'],
    ['FAILED', 'CONFIRMED'],
    ['FAILED', 'CANCELLED'],
    ['CANCELLED', 'CONFIRMED'],
    ['CANCELLED', 'PENDING'],
    ['PENDING', 'PENDING'],
  ] as const)('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('only PENDING and CONFIRMED bookings can be cancelled', () => {
    expect(statusesThatCanBecome('CANCELLED').sort()).toEqual(['CONFIRMED', 'PENDING']);
  });
});

describe('POST /bookings', () => {
  it('creates a PENDING booking priced from the offering, owned by the caller', async () => {
    const res = await book(cbcAtHealthFirst());

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      amountPaise: 35000,
      centreId: healthFirstId,
      testId: cbcId,
      centre: { id: healthFirstId, name: 'HealthFirst' },
      test: { id: cbcId, name: 'CBC' },
    });
    expect(res.body.data).not.toHaveProperty('userId');
    const stored = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.userId).toBe(alice.userId);
  });

  it('uses the price of the chosen centre', async () => {
    const res = await book({ ...cbcAtHealthFirst(), centreId: cityCareId });

    expect(res.body.data.amountPaise).toBe(42000);
  });

  it('returns 401 without a token and creates nothing', async () => {
    const res = await request(app).post('/bookings').send(cbcAtHealthFirst());

    expect(res.status).toBe(401);
    expect(await prisma.booking.count()).toBe(0);
  });

  it('returns 404 for a nonexistent centre', async () => {
    const res = await book({ ...cbcAtHealthFirst(), centreId: UNKNOWN_ID });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/centre/i);
  });

  it('returns 404 for a nonexistent test', async () => {
    const res = await book({ ...cbcAtHealthFirst(), testId: UNKNOWN_ID });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/test/i);
  });

  it('returns 422 when the centre does not offer the test', async () => {
    const res = await book({ ...cbcAtHealthFirst(), testId: mriId }); // HealthFirst has no MRI

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TEST_NOT_OFFERED');
    expect(await prisma.booking.count()).toBe(0);
  });

  it('returns 400 for a client-supplied amount (the price always comes from the server)', async () => {
    const withAmountPaise = await book({ ...cbcAtHealthFirst(), amountPaise: 1 });
    const withAmount = await book({ ...cbcAtHealthFirst(), amount: 1 });

    expect(withAmountPaise.status).toBe(400);
    expect(withAmount.status).toBe(400);
    expect(await prisma.booking.count()).toBe(0);
  });

  it('returns 400 for a client-supplied status', async () => {
    const res = await book({ ...cbcAtHealthFirst(), status: 'CONFIRMED' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an appointment in the past', async () => {
    const res = await book({ ...cbcAtHealthFirst(), appointmentDateTime: daysFromNow(-1) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // A date in January of next year: always in the future, never needs updating.
  const nextYear = new Date().getUTCFullYear() + 1;

  it.each([
    ['without a timezone', `${nextYear}-01-15T10:00:00`],
    ['that is not a date', 'next tuesday'],
  ])('returns 400 for an appointment time %s', async (_label, appointmentDateTime) => {
    const res = await book({ ...cbcAtHealthFirst(), appointmentDateTime });

    expect(res.status).toBe(400);
  });

  it('accepts a timezone offset and stores the correct instant (returned in UTC)', async () => {
    const res = await book({
      ...cbcAtHealthFirst(),
      appointmentDateTime: `${nextYear}-01-15T10:00:00+05:30`,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.appointmentDateTime).toBe(`${nextYear}-01-15T04:30:00.000Z`);
  });

  it('returns 400 for malformed ids in the body', async () => {
    const res = await book({ ...cbcAtHealthFirst(), centreId: 'abc' });

    expect(res.status).toBe(400);
  });

  it('returns 409 for a duplicate active booking (double click)', async () => {
    const body = cbcAtHealthFirst();
    await book(body);

    const res = await book(body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_BOOKING');
  });

  it('allows re-booking the same slot after cancelling', async () => {
    const body = cbcAtHealthFirst();
    const first = (await book(body)).body.data;
    await cancel(first.id);

    const res = await book(body);

    expect(res.status).toBe(201);
  });

  it('keeps the booked amount when an admin later changes the price', async () => {
    const booking = await bookCbc();

    const patch = await request(app)
      .patch(`/centres/${healthFirstId}/tests/${cbcId}`)
      .set('Authorization', adminAuth)
      .send({ pricePaise: 99900 });
    expect(patch.status).toBe(200);

    expect((await getBooking(booking.id)).body.data.amountPaise).toBe(35000);
    expect((await bookCbc()).amountPaise).toBe(99900); // new bookings use the new price
  });

  it('is refused by the database for a centre/test pair that is not offered (composite FK)', async () => {
    await expect(
      prisma.booking.create({
        data: {
          userId: alice.userId,
          centreId: healthFirstId,
          testId: mriId, // not offered at HealthFirst
          appointmentDateTime: new Date(daysFromNow(1)),
          amountPaise: 1000,
        },
      }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });
});

describe('GET /bookings', () => {
  it("returns only the caller's bookings, newest first", async () => {
    const older = await bookCbc();
    const newer = await bookCbc();
    await bookCbc(bob.auth);
    // Make the order explicit instead of relying on two requests landing in different milliseconds.
    await prisma.booking.update({
      where: { id: older.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(app).get('/bookings').set('Authorization', alice.auth);

    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { id: string }) => b.id)).toEqual([newer.id, older.id]);
  });

  it("does not show other users' bookings to an admin", async () => {
    await bookCbc(bob.auth);

    const res = await request(app).get('/bookings').set('Authorization', adminAuth);

    expect(res.body.data).toEqual([]);
  });

  it('returns 401 without a token', async () => {
    expect((await request(app).get('/bookings')).status).toBe(401);
  });
});

describe('GET /bookings/:id', () => {
  it('returns the booking to its owner', async () => {
    const booking = await bookCbc();

    const res = await getBooking(booking.id);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(booking.id);
  });

  it("returns 404 (not 403) when fetching another user's booking", async () => {
    const booking = await bookCbc(alice.auth);

    const res = await getBooking(booking.id, bob.auth);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a nonexistent booking', async () => {
    expect((await getBooking(UNKNOWN_ID)).status).toBe(404);
  });

  it('returns 400 for a malformed booking id', async () => {
    expect((await getBooking('not-a-uuid')).status).toBe(400);
  });
});

describe('PATCH /bookings/:id/cancel', () => {
  it('cancels a PENDING booking', async () => {
    const booking = await bookCbc();

    const res = await cancel(booking.id);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('cancels a CONFIRMED booking (no refund; out of scope)', async () => {
    const booking = await bookCbc();
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } });

    const res = await cancel(booking.id);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('returns 409 when cancelling twice', async () => {
    const booking = await bookCbc();
    await cancel(booking.id);

    const res = await cancel(booking.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns 409 when cancelling a FAILED booking', async () => {
    const booking = await bookCbc();
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'FAILED' } });

    const res = await cancel(booking.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns 409 after the appointment time has passed', async () => {
    const booking = await bookCbc();
    await prisma.booking.update({
      where: { id: booking.id },
      data: { appointmentDateTime: new Date(daysFromNow(-1)) },
    });

    const res = await cancel(booking.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPOINTMENT_PASSED');
  });

  it("returns 404 when cancelling another user's booking, and leaves it unchanged", async () => {
    const booking = await bookCbc(alice.auth);

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
    const booking = await bookCbc();

    expect((await request(app).patch(`/bookings/${booking.id}/cancel`)).status).toBe(401);
  });

  it('lets exactly one of two concurrent cancels succeed', async () => {
    const booking = await bookCbc();

    const results = await Promise.all([cancel(booking.id), cancel(booking.id)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});
