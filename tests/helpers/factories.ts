import type { Role } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/utils/jwt';
import { prisma } from './db';

/**
 * Small factories so each test creates exactly the data it needs (no seed data, no shared state).
 * Database rows are inserted directly when the test is not *about* creating them; flows under test
 * (booking, paying, webhooks) go through the real API.
 */

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;
let counter = 0;
const next = () => (counter += 1);

/** A user with the given role, plus an "Authorization" header value for it. */
export const createUser = async (role: Role = 'USER') => {
  const n = next();
  const user = await prisma.user.create({
    data: {
      name: `${role} ${n}`,
      email: `${role.toLowerCase()}${n}@example.com`,
      passwordHash: 'not-a-real-hash', // these users never log in through the API
      role,
    },
  });
  return { user, auth: `Bearer ${signAccessToken(user)}` };
};

export const createCentre = (name = `Centre ${next()}`, location = 'Bengaluru') =>
  prisma.diagnosticCentre.create({ data: { name, location } });

export const createTest = (name = `Test ${next()}`) =>
  prisma.diagnosticTest.create({ data: { name } });

export const createOffering = (centreId: string, testId: string, pricePaise = 35000) =>
  prisma.centreTestOffering.create({ data: { centreId, testId, pricePaise } });

/** A centre offering one test at the given price. */
export const createCentreWithTest = async (pricePaise = 35000) => {
  const centre = await createCentre();
  const test = await createTest();
  await createOffering(centre.id, test.id, pricePaise);
  return { centreId: centre.id, testId: test.id };
};

/** A future ISO timestamp `days` from now. Relative, so tests never expire. */
export const daysFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString();

/** A different future appointment every call, so bookings never collide by accident. */
export const nextAppointment = () => daysFromNow(7 + next());

/** Books through the API (POST /bookings) and returns the created booking. */
export const createBookingFor = async (
  auth: string,
  offering: { centreId: string; testId: string },
  appointmentDateTime = nextAppointment(),
) => {
  const res = await request(app)
    .post('/bookings')
    .set('Authorization', auth)
    .send({ ...offering, appointmentDateTime });
  if (res.status !== 201) throw new Error(`createBookingFor failed: ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; amountPaise: number; status: string };
};

/** POST /payments. Without an outcome the payment stays PENDING until a webhook settles it. */
export const payFor = (auth: string, bookingId: string, simulateOutcome?: 'SUCCESS' | 'FAILED') =>
  request(app)
    .post('/payments')
    .set('Authorization', auth)
    .send({ bookingId, ...(simulateOutcome && { simulateOutcome }) });

/** POST /payments/webhook/ as the provider would send it (pass `null` to omit the secret). */
export const sendWebhook = (
  body: object,
  secret: string | null = process.env.WEBHOOK_SECRET as string,
) => {
  const req = request(app).post('/payments/webhook/');
  if (secret !== null) req.set('X-Webhook-Secret', secret);
  return req.send(body);
};
