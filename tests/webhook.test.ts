import request from 'supertest';
import { createApp } from '../src/app';
import { paymentEventRepository } from '../src/repositories/payment.repository';
import { logger } from '../src/utils/logger';
import { createUserWithToken } from './helpers/auth';
import { prisma, resetDatabase } from './helpers/db';

const app = createApp();
const SECRET = process.env.WEBHOOK_SECRET as string;
const DAY = 24 * 60 * 60 * 1000;

let userAuth: string;
let bookingId: string;
let providerPaymentId: string;
let amount: number;

let appointmentOffset = 0;
/** Creates a booking and a PENDING payment (POST /payments without simulateOutcome). */
const createPendingPayment = async () => {
  const centre = await prisma.diagnosticCentre.findFirstOrThrow();
  const test = await prisma.diagnosticTest.findFirstOrThrow();
  appointmentOffset += 1;
  const booking = await request(app)
    .post('/bookings')
    .set('Authorization', userAuth)
    .send({
      centreId: centre.id,
      testId: test.id,
      appointmentDateTime: new Date(Date.now() + (7 + appointmentOffset) * DAY).toISOString(),
    });
  const payment = await request(app)
    .post('/payments')
    .set('Authorization', userAuth)
    .send({ bookingId: booking.body.data.id });
  expect(payment.status).toBe(202);
  return {
    bookingId: booking.body.data.id as string,
    providerPaymentId: payment.body.data.providerPaymentId as string,
    amount: payment.body.data.amountPaise as number,
  };
};

beforeEach(async () => {
  await resetDatabase();
  userAuth = (await createUserWithToken('USER')).auth;
  const centre = await prisma.diagnosticCentre.create({
    data: { name: 'HealthFirst', location: 'Bengaluru' },
  });
  const test = await prisma.diagnosticTest.create({ data: { name: 'CBC' } });
  await prisma.centreTestOffering.create({
    data: { centreId: centre.id, testId: test.id, pricePaise: 35000 },
  });
  ({ bookingId, providerPaymentId, amount } = await createPendingPayment());
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const event = (overrides: object = {}) => ({
  eventId: 'evt_1',
  providerPaymentId,
  status: 'SUCCESS',
  amount,
  ...overrides,
});

const send = (body: object, secret: string | null = SECRET) => {
  const req = request(app).post('/payments/webhook/');
  if (secret !== null) req.set('X-Webhook-Secret', secret);
  return req.send(body);
};

const state = async () => {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId } });
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  return { payment: payment.status, booking: booking.status, bookingUpdatedAt: booking.updatedAt };
};

const eventRows = () => prisma.paymentEvent.findMany({ orderBy: { receivedAt: 'asc' } });

describe('new events', () => {
  it('SUCCESS settles the PENDING payment and confirms the booking', async () => {
    const res = await send(event());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      eventId: 'evt_1',
      providerPaymentId,
      status: 'SUCCESS',
      outcome: 'APPLIED',
    });
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });
  });

  it('FAILED settles the PENDING payment and fails the booking', async () => {
    const res = await send(event({ status: 'FAILED' }));

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('APPLIED');
    expect(await state()).toMatchObject({ payment: 'FAILED', booking: 'FAILED' });
  });

  it('stores the raw payload on the event', async () => {
    await send(event());

    const [row] = await eventRows();
    expect(row.payload).toEqual(event());
  });

  it('works without the trailing slash too', async () => {
    const res = await request(app)
      .post('/payments/webhook')
      .set('X-Webhook-Secret', SECRET)
      .send(event());

    expect(res.status).toBe(200);
  });
});

describe('idempotency level 1: the same event ID delivered again', () => {
  it.each(['SUCCESS', 'FAILED'])(
    'the same %s event sent 3 times gives identical responses and one row',
    async (status) => {
      const responses = [];
      for (let i = 0; i < 3; i += 1) responses.push(await send(event({ status })));

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(responses[1].body).toEqual(responses[0].body);
      expect(responses[2].body).toEqual(responses[0].body);

      const rows = await eventRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome).toBe('APPLIED');
      expect(await prisma.payment.count()).toBe(1);
      expect(await prisma.booking.count()).toBe(1);
      expect(await state()).toMatchObject({
        payment: status,
        booking: status === 'SUCCESS' ? 'CONFIRMED' : 'FAILED',
      });
    },
  );

  it('the same event sent 5 times concurrently is applied exactly once', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => send(event())));

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    for (const r of responses) expect(r.body.data.outcome).toBe('APPLIED');

    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('APPLIED');
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });
  });

  it('the same event ID with a different payload returns the stored result and logs it', async () => {
    const warn = jest.spyOn(logger, 'warn');
    const first = await send(event({ status: 'SUCCESS' }));

    const second = await send(event({ status: 'FAILED' }));

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await eventRows()).toHaveLength(1);
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/different payload/),
      expect.anything(),
    );
  });
});

describe('idempotency level 2: a new event ID reporting the same outcome', () => {
  it('is recorded as DUPLICATE_STATE and changes nothing', async () => {
    await send(event({ eventId: 'evt_1' }));
    const before = await state();

    const res = await send(event({ eventId: 'evt_2' }));

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('DUPLICATE_STATE');
    expect((await eventRows()).map((r) => r.outcome)).toEqual(['APPLIED', 'DUPLICATE_STATE']);
    const after = await state();
    expect(after).toEqual(before); // same statuses and booking not even touched (updatedAt)
  });

  it('confirms a payment already settled synchronously by POST /payments', async () => {
    const centre = await prisma.diagnosticCentre.findFirstOrThrow();
    const test = await prisma.diagnosticTest.findFirstOrThrow();
    const booking = await request(app)
      .post('/bookings')
      .set('Authorization', userAuth)
      .send({
        centreId: centre.id,
        testId: test.id,
        appointmentDateTime: new Date(Date.now() + 30 * DAY).toISOString(),
      });
    const paid = await request(app)
      .post('/payments')
      .set('Authorization', userAuth)
      .send({ bookingId: booking.body.data.id, simulateOutcome: 'SUCCESS' });

    const res = await send({
      eventId: 'evt_sync',
      providerPaymentId: paid.body.data.providerPaymentId,
      status: 'SUCCESS',
      amount: paid.body.data.amountPaise,
    });

    expect(res.body.data.outcome).toBe('DUPLICATE_STATE');
  });
});

describe('conflicting events', () => {
  it('SUCCESS then FAILED: booking stays CONFIRMED, event IGNORED_CONFLICT, warning logged', async () => {
    const warn = jest.spyOn(logger, 'warn');
    await send(event({ eventId: 'evt_1', status: 'SUCCESS' }));

    const res = await send(event({ eventId: 'evt_2', status: 'FAILED' }));

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('IGNORED_CONFLICT');
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Conflicting/), expect.anything());
  });

  it('FAILED then SUCCESS: booking stays FAILED (terminal), flagged for manual reconciliation', async () => {
    const warn = jest.spyOn(logger, 'warn');
    await send(event({ eventId: 'evt_1', status: 'FAILED' }));

    const res = await send(event({ eventId: 'evt_2', status: 'SUCCESS' }));

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('IGNORED_CONFLICT');
    expect(await state()).toMatchObject({ payment: 'FAILED', booking: 'FAILED' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Conflicting/),
      expect.objectContaining({ action: 'MANUAL_RECONCILIATION_REQUIRED' }),
    );
  });

  it('SUCCESS for a booking cancelled while the payment was pending: payment SUCCESS, booking stays CANCELLED', async () => {
    const warn = jest.spyOn(logger, 'warn');
    const cancel = await request(app)
      .patch(`/bookings/${bookingId}/cancel`)
      .set('Authorization', userAuth);
    expect(cancel.status).toBe(200);

    const res = await send(event());

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('APPLIED');
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CANCELLED' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/booking status left unchanged/),
      expect.objectContaining({ action: 'REFUND_REQUIRED' }),
    );
  });
});

describe('event recording and state change are one transaction', () => {
  it('a crash after settling but before saving the event rolls both back, so the retry applies cleanly', async () => {
    jest.spyOn(logger, 'error').mockImplementation(() => {}); // expected 500 below
    jest
      .spyOn(paymentEventRepository, 'create')
      .mockRejectedValueOnce(new Error('simulated crash before the event row is written'));

    const crashed = await send(event());

    expect(crashed.status).toBe(500);
    // Nothing half-done: the payment/booking update was rolled back with the missing event row.
    expect(await eventRows()).toHaveLength(0);
    expect(await state()).toMatchObject({ payment: 'PENDING', booking: 'PENDING' });

    const retry = await send(event()); // the provider retries the same event

    expect(retry.status).toBe(200);
    expect(retry.body.data.outcome).toBe('APPLIED');
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });
  });
});

describe('rejected webhooks write nothing', () => {
  it.each([
    ['missing', null],
    ['wrong', 'not-the-secret'],
  ])('returns 401 for a %s secret', async (_label, secret) => {
    const res = await send(event(), secret);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SECRET');
    expect(await eventRows()).toHaveLength(0);
    expect(await state()).toMatchObject({ payment: 'PENDING', booking: 'PENDING' });
  });

  it('returns 404 for an unknown providerPaymentId', async () => {
    const res = await send(event({ providerPaymentId: 'mock_pay_does_not_exist' }));

    expect(res.status).toBe(404);
    expect(await eventRows()).toHaveLength(0);
  });

  it('returns 422 for an amount that does not match the payment, and applies nothing', async () => {
    const res = await send(event({ amount: amount + 1 }));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('AMOUNT_MISMATCH');
    expect(await eventRows()).toHaveLength(0);
    expect(await state()).toMatchObject({ payment: 'PENDING', booking: 'PENDING' });
  });

  it.each([
    ['status PENDING', { status: 'PENDING' }],
    ['unknown status', { status: 'REFUNDED' }],
    ['missing eventId', { eventId: undefined }],
    ['empty providerPaymentId', { providerPaymentId: '' }],
    ['fractional amount', { amount: 350.5 }],
    ['amount as a string', { amount: '35000' }],
    ['an unknown field', { bookingId: 'x' }],
  ])('returns 400 for %s', async (_label, overrides) => {
    const res = await send(event(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await eventRows()).toHaveLength(0);
  });

  it('returns 400 for a non-JSON body', async () => {
    const res = await request(app)
      .post('/payments/webhook/')
      .set('X-Webhook-Secret', SECRET)
      .set('Content-Type', 'application/json')
      .send('{"eventId":');

    expect(res.status).toBe(400);
  });
});

describe('the webhook never creates payments or bookings', () => {
  it('leaves row counts unchanged across a burst of mixed events', async () => {
    const before = {
      payments: await prisma.payment.count(),
      bookings: await prisma.booking.count(),
    };

    await send(event({ eventId: 'e1', status: 'SUCCESS' }));
    await send(event({ eventId: 'e1', status: 'SUCCESS' }));
    await send(event({ eventId: 'e2', status: 'FAILED' }));
    await send(event({ eventId: 'e3', providerPaymentId: 'unknown' }));

    expect(await prisma.payment.count()).toBe(before.payments);
    expect(await prisma.booking.count()).toBe(before.bookings);
  });
});

describe('concurrent duplicate delivery race', () => {
  it('answers with the stored result when the unique event ID rejects the losing insert', async () => {
    const first = await send(event());
    // Open the race window: make the "already stored?" check miss once, as if another delivery
    // committed just after we looked. The INSERT then hits the unique provider_event_id, the
    // transaction rolls back, and the handler replies with the committed result.
    jest.spyOn(paymentEventRepository, 'findByProviderEventId').mockResolvedValueOnce(null);

    const second = await send(event());

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await eventRows()).toHaveLength(1);
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });
  });
});
