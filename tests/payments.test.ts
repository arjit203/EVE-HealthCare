import request from 'supertest';
import { createApp } from '../src/app';
import { createUserWithToken } from './helpers/auth';
import { prisma, resetDatabase } from './helpers/db';

const app = createApp();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const DAY = 24 * 60 * 60 * 1000;

let alice: string;
let bob: string;
let adminAuth: string;
let centreId: string;
let testId: string;

beforeEach(async () => {
  await resetDatabase();
  alice = (await createUserWithToken('USER')).auth;
  bob = (await createUserWithToken('USER')).auth;
  adminAuth = (await createUserWithToken('ADMIN')).auth;

  const centre = await prisma.diagnosticCentre.create({
    data: { name: 'HealthFirst', location: 'Koramangala, Bengaluru' },
  });
  const test = await prisma.diagnosticTest.create({ data: { name: 'CBC' } });
  await prisma.centreTestOffering.create({
    data: { centreId: centre.id, testId: test.id, pricePaise: 35000 },
  });
  centreId = centre.id;
  testId = test.id;
});
afterAll(() => prisma.$disconnect());

let bookingCounter = 0;
const createBooking = async (auth = alice) => {
  bookingCounter += 1;
  const res = await request(app)
    .post('/bookings')
    .set('Authorization', auth)
    .send({
      centreId,
      testId,
      appointmentDateTime: new Date(Date.now() + (7 + bookingCounter) * DAY).toISOString(),
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; amountPaise: number };
};

const pay = (body: object, auth = alice) =>
  request(app).post('/payments').set('Authorization', auth).send(body);

const bookingStatus = async (id: string) =>
  (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;

describe('POST /payments — successful payment', () => {
  it('returns 201 SUCCESS and confirms the booking', async () => {
    const booking = await createBooking();

    const res = await pay({ bookingId: booking.id, simulateOutcome: 'SUCCESS' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      bookingId: booking.id,
      status: 'SUCCESS',
      amountPaise: 35000,
      booking: { id: booking.id, status: 'CONFIRMED' },
    });
    expect(res.body.data.providerPaymentId).toMatch(/^mock_pay_[0-9a-f-]{36}$/);
    expect(await bookingStatus(booking.id)).toBe('CONFIRMED');
  });

  it('without simulateOutcome: returns 202 with a PENDING payment and leaves the booking PENDING', async () => {
    const booking = await createBooking();

    const res = await pay({ bookingId: booking.id });

    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      amountPaise: 35000,
      booking: { id: booking.id, status: 'PENDING' },
    });
    expect(await bookingStatus(booking.id)).toBe('PENDING');
  });

  it('returns 409 when paying again while a PENDING payment awaits its webhook', async () => {
    const booking = await createBooking();
    await pay({ bookingId: booking.id });

    const res = await pay({ bookingId: booking.id, simulateOutcome: 'SUCCESS' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_ALREADY_EXISTS');
    expect(await prisma.payment.count()).toBe(1);
  });

  it('charges the booking amount, even if the price changed after booking', async () => {
    const booking = await createBooking(); // booked at 35000
    await request(app)
      .patch(`/centres/${centreId}/tests/${testId}`)
      .set('Authorization', adminAuth)
      .send({ pricePaise: 99900 });

    const res = await pay({ bookingId: booking.id, simulateOutcome: 'SUCCESS' });

    expect(res.body.data.amountPaise).toBe(booking.amountPaise);
    expect(res.body.data.amountPaise).toBe(35000);
  });

  it('shows the payment on GET /bookings/:id', async () => {
    const booking = await createBooking();
    const payment = (await pay({ bookingId: booking.id, simulateOutcome: 'SUCCESS' })).body.data;

    const res = await request(app).get(`/bookings/${booking.id}`).set('Authorization', alice);

    expect(res.body.data.status).toBe('CONFIRMED');
    expect(res.body.data.payment).toMatchObject({
      id: payment.id,
      status: 'SUCCESS',
      providerPaymentId: payment.providerPaymentId,
    });
  });
});

describe('POST /payments — failed payment', () => {
  it('returns 201 (not 4xx) with status FAILED and marks the booking FAILED', async () => {
    const booking = await createBooking();

    const res = await pay({ bookingId: booking.id, simulateOutcome: 'FAILED' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'FAILED',
      booking: { status: 'FAILED' },
    });
    expect(await bookingStatus(booking.id)).toBe('FAILED');
  });

  it('rejects a later payment for the FAILED booking with 409', async () => {
    const booking = await createBooking();
    await pay({ bookingId: booking.id, simulateOutcome: 'FAILED' });

    const res = await pay({ bookingId: booking.id, simulateOutcome: 'SUCCESS' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_NOT_PAYABLE');
    expect(await bookingStatus(booking.id)).toBe('FAILED');
    expect(await prisma.payment.count()).toBe(1);
  });
});

describe('POST /payments — invalid requests', () => {
  it('returns 400 when the body contains an amount, and creates nothing', async () => {
    const booking = await createBooking();

    const res = await pay({ bookingId: booking.id, amountPaise: 1 });
    const res2 = await pay({ bookingId: booking.id, amount: 1 });

    expect(res.status).toBe(400);
    expect(res2.status).toBe(400);
    expect(await prisma.payment.count()).toBe(0);
    expect(await bookingStatus(booking.id)).toBe('PENDING');
  });

  it.each([
    ['missing bookingId', {}],
    ['malformed bookingId', { bookingId: 'abc' }],
    ['unknown simulateOutcome', { bookingId: UNKNOWN_ID, simulateOutcome: 'MAYBE' }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await pay(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without a token', async () => {
    const booking = await createBooking();

    const res = await request(app).post('/payments').send({ bookingId: booking.id });

    expect(res.status).toBe(401);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const res = await pay({ bookingId: UNKNOWN_ID });

    expect(res.status).toBe(404);
  });

  it("returns 404 for another user's booking and leaves it unpaid", async () => {
    const booking = await createBooking(alice);

    const res = await pay({ bookingId: booking.id }, bob);

    expect(res.status).toBe(404);
    expect(await prisma.payment.count()).toBe(0);
    expect(await bookingStatus(booking.id)).toBe('PENDING');
  });
});

describe('POST /payments — booking state rules', () => {
  it('returns 409 for a cancelled booking', async () => {
    const booking = await createBooking();
    await request(app).patch(`/bookings/${booking.id}/cancel`).set('Authorization', alice);

    const res = await pay({ bookingId: booking.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_NOT_PAYABLE');
    expect(await prisma.payment.count()).toBe(0);
  });

  it('returns 409 when paying twice, with only one payment row', async () => {
    const booking = await createBooking();
    await pay({ bookingId: booking.id });

    const res = await pay({ bookingId: booking.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_ALREADY_EXISTS');
    expect(await prisma.payment.count()).toBe(1);
  });

  it('returns 409 after the appointment time has passed', async () => {
    const booking = await createBooking();
    await prisma.booking.update({
      where: { id: booking.id },
      data: { appointmentDateTime: new Date(Date.now() - DAY) },
    });

    const res = await pay({ bookingId: booking.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPOINTMENT_PASSED');
  });
});

describe('POST /payments — concurrency', () => {
  it('lets exactly one of two simultaneous payments succeed', async () => {
    const booking = await createBooking();

    const results = await Promise.all([
      pay({ bookingId: booking.id, simulateOutcome: 'SUCCESS' }),
      pay({ bookingId: booking.id, simulateOutcome: 'SUCCESS' }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(await bookingStatus(booking.id)).toBe('CONFIRMED');
  });

  it('never lets a simultaneous SUCCESS and FAILED both apply', async () => {
    const booking = await createBooking();

    const results = await Promise.all([
      pay({ bookingId: booking.id, simulateOutcome: 'SUCCESS' }),
      pay({ bookingId: booking.id, simulateOutcome: 'FAILED' }),
    ]);

    const winner = results.find((r) => r.status === 201)!;
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await bookingStatus(booking.id)).toBe(winner.body.data.booking.status);
  });

  it('keeps a consistent state when a payment and a cancel race', async () => {
    const booking = await createBooking();

    const [payRes, cancelRes] = await Promise.all([
      pay({ bookingId: booking.id, simulateOutcome: 'SUCCESS' }),
      request(app).patch(`/bookings/${booking.id}/cancel`).set('Authorization', alice),
    ]);

    // Cancel always wins eventually (PENDING → CANCELLED, or CONFIRMED → CANCELLED).
    expect(cancelRes.status).toBe(200);
    expect(await bookingStatus(booking.id)).toBe('CANCELLED');
    // Either the payment went through first (then the paid booking was cancelled),
    // or the cancel went first and the payment was refused — never anything in between.
    const payments = await prisma.payment.count();
    if (payRes.status === 201) expect(payments).toBe(1);
    else {
      expect(payRes.status).toBe(409);
      expect(payments).toBe(0);
    }
  });
});
