/**
 * Module 4 — Simulated payments (POST /payments): outcomes, amount integrity, ownership,
 * booking-state rules and concurrency.
 */
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, resetDatabase } from './helpers/db';
import {
  createBookingFor,
  createCentreWithTest,
  createUser,
  daysFromNow,
  payFor,
} from './helpers/factories';

const app = createApp();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

let alice: string;
let bob: string;
let adminAuth: string;
let offering: { centreId: string; testId: string };

beforeEach(async () => {
  await resetDatabase();
  alice = (await createUser()).auth;
  bob = (await createUser()).auth;
  adminAuth = (await createUser('ADMIN')).auth;
  offering = await createCentreWithTest(35000);
});
afterAll(() => prisma.$disconnect());

const book = (auth = alice) => createBookingFor(auth, offering);

/** Raw POST /payments with any body, for validation tests. */
const postPayment = (body: object, auth = alice) =>
  request(app).post('/payments').set('Authorization', auth).send(body);

const cancel = (bookingId: string, auth = alice) =>
  request(app).patch(`/bookings/${bookingId}/cancel`).set('Authorization', auth);

const bookingStatus = async (id: string) =>
  (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;

describe('successful payment', () => {
  it('returns 201 SUCCESS and confirms the booking', async () => {
    const booking = await book();

    const res = await payFor(alice, booking.id, 'SUCCESS');

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

  it('charges the booking amount, even if the price changed after booking', async () => {
    const booking = await book(); // booked at 35000
    await request(app)
      .patch(`/centres/${offering.centreId}/tests/${offering.testId}`)
      .set('Authorization', adminAuth)
      .send({ pricePaise: 99900 });

    const res = await payFor(alice, booking.id, 'SUCCESS');

    expect(res.body.data.amountPaise).toBe(booking.amountPaise);
    expect(res.body.data.amountPaise).toBe(35000);
  });

  it('shows the payment on GET /bookings/:id', async () => {
    const booking = await book();
    const payment = (await payFor(alice, booking.id, 'SUCCESS')).body.data;

    const res = await request(app).get(`/bookings/${booking.id}`).set('Authorization', alice);

    expect(res.body.data.status).toBe('CONFIRMED');
    expect(res.body.data.payment).toMatchObject({
      id: payment.id,
      status: 'SUCCESS',
      providerPaymentId: payment.providerPaymentId,
    });
  });
});

describe('pending payment (settled later by the webhook)', () => {
  it('returns 202 with a PENDING payment and leaves the booking PENDING', async () => {
    const booking = await book();

    const res = await payFor(alice, booking.id);

    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      amountPaise: 35000,
      booking: { id: booking.id, status: 'PENDING' },
    });
    expect(await bookingStatus(booking.id)).toBe('PENDING');
  });

  it('returns 409 when paying again while the PENDING payment awaits its webhook', async () => {
    const booking = await book();
    await payFor(alice, booking.id);

    const res = await payFor(alice, booking.id, 'SUCCESS');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_ALREADY_EXISTS');
    expect(await prisma.payment.count()).toBe(1);
  });
});

describe('failed payment', () => {
  it('returns 201 (not 4xx) with status FAILED and marks the booking FAILED', async () => {
    const booking = await book();

    const res = await payFor(alice, booking.id, 'FAILED');

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'FAILED', booking: { status: 'FAILED' } });
    expect(await bookingStatus(booking.id)).toBe('FAILED');
  });

  it('returns 409 for a later payment attempt on the FAILED booking', async () => {
    const booking = await book();
    await payFor(alice, booking.id, 'FAILED');

    const res = await payFor(alice, booking.id, 'SUCCESS');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_NOT_PAYABLE');
    expect(await bookingStatus(booking.id)).toBe('FAILED');
    expect(await prisma.payment.count()).toBe(1);
  });
});

describe('invalid requests', () => {
  it('returns 400 when the body contains an amount, and creates nothing', async () => {
    const booking = await book();

    const withAmountPaise = await postPayment({ bookingId: booking.id, amountPaise: 1 });
    const withAmount = await postPayment({ bookingId: booking.id, amount: 1 });

    expect(withAmountPaise.status).toBe(400);
    expect(withAmount.status).toBe(400);
    expect(await prisma.payment.count()).toBe(0);
    expect(await bookingStatus(booking.id)).toBe('PENDING');
  });

  it.each([
    ['missing bookingId', {}],
    ['malformed bookingId', { bookingId: 'abc' }],
    ['unknown simulateOutcome', { bookingId: UNKNOWN_ID, simulateOutcome: 'MAYBE' }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await postPayment(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without a token', async () => {
    const booking = await book();

    const res = await request(app).post('/payments').send({ bookingId: booking.id });

    expect(res.status).toBe(401);
  });

  it('returns 404 for a nonexistent booking', async () => {
    const res = await payFor(alice, UNKNOWN_ID);

    expect(res.status).toBe(404);
  });

  it("returns 404 when paying for another user's booking, and leaves it unpaid", async () => {
    const booking = await book(alice);

    const res = await payFor(bob, booking.id);

    expect(res.status).toBe(404);
    expect(await prisma.payment.count()).toBe(0);
    expect(await bookingStatus(booking.id)).toBe('PENDING');
  });
});

describe('booking state rules', () => {
  it('returns 409 for a cancelled booking', async () => {
    const booking = await book();
    await cancel(booking.id);

    const res = await payFor(alice, booking.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_NOT_PAYABLE');
    expect(await prisma.payment.count()).toBe(0);
  });

  it('returns 409 when paying twice, with only one payment row', async () => {
    const booking = await book();
    await payFor(alice, booking.id);

    const res = await payFor(alice, booking.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_ALREADY_EXISTS');
    expect(await prisma.payment.count()).toBe(1);
  });

  it('returns 409 after the appointment time has passed', async () => {
    const booking = await book();
    await prisma.booking.update({
      where: { id: booking.id },
      data: { appointmentDateTime: new Date(daysFromNow(-1)) },
    });

    const res = await payFor(alice, booking.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPOINTMENT_PASSED');
  });
});

describe('concurrency', () => {
  it('lets exactly one of two simultaneous payments succeed (no double payment)', async () => {
    const booking = await book();

    const results = await Promise.all([
      payFor(alice, booking.id, 'SUCCESS'),
      payFor(alice, booking.id, 'SUCCESS'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(await bookingStatus(booking.id)).toBe('CONFIRMED');
  });

  it('never lets a simultaneous SUCCESS and FAILED both apply', async () => {
    const booking = await book();

    const results = await Promise.all([
      payFor(alice, booking.id, 'SUCCESS'),
      payFor(alice, booking.id, 'FAILED'),
    ]);

    const winner = results.find((r) => r.status === 201)!;
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await bookingStatus(booking.id)).toBe(winner.body.data.booking.status);
  });

  it('keeps a consistent state when a payment and a cancel race', async () => {
    const booking = await book();

    const [payRes, cancelRes] = await Promise.all([
      payFor(alice, booking.id, 'SUCCESS'),
      cancel(booking.id),
    ]);

    // Cancel always succeeds (PENDING → CANCELLED, or CONFIRMED → CANCELLED).
    expect(cancelRes.status).toBe(200);
    expect(await bookingStatus(booking.id)).toBe('CANCELLED');
    // Either the payment went first (then the paid booking was cancelled), or the cancel went
    // first and the payment was refused — never anything in between.
    const payments = await prisma.payment.count();
    if (payRes.status === 201) expect(payments).toBe(1);
    else {
      expect(payRes.status).toBe(409);
      expect(payments).toBe(0);
    }
  });
});
