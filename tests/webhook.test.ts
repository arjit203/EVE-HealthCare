/**
 * Payment webhook (POST /payments/webhook/): settlement, idempotency, conflicts,
 * atomicity and rejection. The webhook only updates existing payments; it never creates any.
 */
import request from 'supertest';
import { createApp } from '../src/app';
import { paymentEventRepository } from '../src/repositories/payment.repository';
import { logger } from '../src/utils/logger';
import { prisma, resetDatabase } from './helpers/db';
import {
  createBookingFor,
  createCentreWithTest,
  createUser,
  payFor,
  sendWebhook,
} from './helpers/factories';

const app = createApp();

let userAuth: string;
let offering: { centreId: string; testId: string };
// The booking with a PENDING payment that each test's webhook events refer to.
let bookingId: string;
let providerPaymentId: string;
let amount: number;

beforeEach(async () => {
  await resetDatabase();
  userAuth = (await createUser()).auth;
  offering = await createCentreWithTest(35000);
  const booking = await createBookingFor(userAuth, offering);
  const payment = await payFor(userAuth, booking.id); // no outcome → PENDING, awaits the webhook
  expect(payment.status).toBe(202);
  bookingId = booking.id;
  providerPaymentId = payment.body.data.providerPaymentId;
  amount = payment.body.data.amountPaise;
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

/** A provider event for this test's payment; override any field. */
const event = (overrides: object = {}) => ({
  eventId: 'evt_1',
  providerPaymentId,
  status: 'SUCCESS',
  amount,
  ...overrides,
});

const state = async () => {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId } });
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  return { payment: payment.status, booking: booking.status, bookingUpdatedAt: booking.updatedAt };
};

const eventRows = () => prisma.paymentEvent.findMany({ orderBy: { receivedAt: 'asc' } });

describe('webhook idempotency — the same event E1 delivered twice', () => {
  it('applies E1 once: one event row, one payment, booking CONFIRMED, identical responses', async () => {
    // 1. Send E1.
    const first = await sendWebhook(event({ eventId: 'E1', status: 'SUCCESS' }));

    // 2–3. It settled the existing PENDING payment and confirmed the booking.
    expect(first.status).toBe(200);
    expect(first.body.data.outcome).toBe('APPLIED');
    expect(await prisma.payment.count()).toBe(1);
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });

    // 4. Send exactly the same E1 again.
    const second = await sendWebhook(event({ eventId: 'E1', status: 'SUCCESS' }));

    // 5. Nothing new was created: still one event row (APPLIED) and one payment.
    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ providerEventId: 'E1', outcome: 'APPLIED' });
    expect(await prisma.payment.count()).toBe(1);

    // 6. State is unchanged and the provider got the same answer both times.
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });
});

describe('new events', () => {
  it('SUCCESS settles the PENDING payment and confirms the booking', async () => {
    const res = await sendWebhook(event());

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
    const res = await sendWebhook(event({ status: 'FAILED' }));

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('APPLIED');
    expect(await state()).toMatchObject({ payment: 'FAILED', booking: 'FAILED' });
  });

  it('stores the raw payload on the event', async () => {
    await sendWebhook(event());

    const [row] = await eventRows();
    expect(row.payload).toEqual(event());
  });

  it('accepts the URL without the trailing slash too', async () => {
    const res = await request(app)
      .post('/payments/webhook')
      .set('X-Webhook-Secret', process.env.WEBHOOK_SECRET as string)
      .send(event());

    expect(res.status).toBe(200);
  });
});

describe('idempotency level 1: the same event ID delivered again', () => {
  it.each(['SUCCESS', 'FAILED'])(
    'the same %s event sent 3 times gives identical responses and one row',
    async (status) => {
      const responses = [];
      for (let i = 0; i < 3; i += 1) responses.push(await sendWebhook(event({ status })));

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
    const responses = await Promise.all(Array.from({ length: 5 }, () => sendWebhook(event())));

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    for (const r of responses) expect(r.body.data.outcome).toBe('APPLIED');
    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('APPLIED');
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });
  });

  it('answers with the stored result when the unique event ID rejects a racing insert', async () => {
    const first = await sendWebhook(event());
    // Open the race window: make the "already stored?" check miss once, as if another delivery
    // committed just after we looked. The INSERT then hits the unique provider_event_id, the
    // transaction rolls back, and the handler replies with the committed result.
    jest.spyOn(paymentEventRepository, 'findByProviderEventId').mockResolvedValueOnce(null);

    const second = await sendWebhook(event());

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await eventRows()).toHaveLength(1);
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });
  });

  it('the same event ID with a different payload returns the stored result and logs it', async () => {
    const warn = jest.spyOn(logger, 'warn');
    const first = await sendWebhook(event({ status: 'SUCCESS' }));

    const second = await sendWebhook(event({ status: 'FAILED' }));

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
    await sendWebhook(event({ eventId: 'evt_1' }));
    const before = await state();

    const res = await sendWebhook(event({ eventId: 'evt_2' }));

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('DUPLICATE_STATE');
    expect((await eventRows()).map((r) => r.outcome)).toEqual(['APPLIED', 'DUPLICATE_STATE']);
    expect(await state()).toEqual(before); // same statuses; booking not even touched (updatedAt)
  });

  it('confirms a payment already settled synchronously by POST /payments', async () => {
    const booking = await createBookingFor(userAuth, offering);
    const paid = (await payFor(userAuth, booking.id, 'SUCCESS')).body.data;

    const res = await sendWebhook({
      eventId: 'evt_sync',
      providerPaymentId: paid.providerPaymentId,
      status: 'SUCCESS',
      amount: paid.amountPaise,
    });

    expect(res.body.data.outcome).toBe('DUPLICATE_STATE');
  });
});

describe('conflicting events', () => {
  it('SUCCESS then FAILED: booking stays CONFIRMED, event IGNORED_CONFLICT, warning logged', async () => {
    const warn = jest.spyOn(logger, 'warn');
    await sendWebhook(event({ eventId: 'evt_1', status: 'SUCCESS' }));

    const res = await sendWebhook(event({ eventId: 'evt_2', status: 'FAILED' }));

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('IGNORED_CONFLICT');
    expect(await state()).toMatchObject({ payment: 'SUCCESS', booking: 'CONFIRMED' });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Conflicting/), expect.anything());
  });

  it('FAILED then SUCCESS: booking stays FAILED (terminal), flagged for manual reconciliation', async () => {
    const warn = jest.spyOn(logger, 'warn');
    await sendWebhook(event({ eventId: 'evt_1', status: 'FAILED' }));

    const res = await sendWebhook(event({ eventId: 'evt_2', status: 'SUCCESS' }));

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

    const res = await sendWebhook(event());

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
    jest.spyOn(logger, 'error').mockImplementation(() => {}); // the 500 below is expected
    jest
      .spyOn(paymentEventRepository, 'create')
      .mockRejectedValueOnce(new Error('simulated crash before the event row is written'));

    const crashed = await sendWebhook(event());

    expect(crashed.status).toBe(500);
    // Nothing half-done: the payment/booking update was rolled back with the missing event row.
    expect(await eventRows()).toHaveLength(0);
    expect(await state()).toMatchObject({ payment: 'PENDING', booking: 'PENDING' });

    const retry = await sendWebhook(event()); // the provider retries the same event

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
    const res = await sendWebhook(event(), secret);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SECRET');
    expect(await eventRows()).toHaveLength(0);
    expect(await state()).toMatchObject({ payment: 'PENDING', booking: 'PENDING' });
  });

  it('returns 404 for an unknown providerPaymentId', async () => {
    const res = await sendWebhook(event({ providerPaymentId: 'mock_pay_does_not_exist' }));

    expect(res.status).toBe(404);
    expect(await eventRows()).toHaveLength(0);
  });

  it('returns 422 for an amount that does not match the payment, and applies nothing', async () => {
    const res = await sendWebhook(event({ amount: amount + 1 }));

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
    const res = await sendWebhook(event(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await eventRows()).toHaveLength(0);
  });

  it('returns 400 for a non-JSON body', async () => {
    const res = await request(app)
      .post('/payments/webhook/')
      .set('X-Webhook-Secret', process.env.WEBHOOK_SECRET as string)
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

    await sendWebhook(event({ eventId: 'e1', status: 'SUCCESS' }));
    await sendWebhook(event({ eventId: 'e1', status: 'SUCCESS' }));
    await sendWebhook(event({ eventId: 'e2', status: 'FAILED' }));
    await sendWebhook(event({ eventId: 'e3', providerPaymentId: 'unknown' }));

    expect(await prisma.payment.count()).toBe(before.payments);
    expect(await prisma.booking.count()).toBe(before.bookings);
  });
});
