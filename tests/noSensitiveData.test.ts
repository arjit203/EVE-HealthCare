import request from 'supertest';
import { createApp } from '../src/app';
import { createUserWithToken } from './helpers/auth';
import { prisma, resetDatabase } from './helpers/db';

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

// The hash field (camelCase or snake_case), any bcrypt hash, or a password value used below echoed
// back. (The word "password" alone is fine: validation errors legitimately name the field.)
const SENSITIVE = /passwordHash|password_hash|\$2[aby]\$|password123|wrong-pw/;

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

it('no response anywhere in the main flow contains a password or password hash', async () => {
  const bodies: string[] = [];
  const record = (res: request.Response) => {
    bodies.push(JSON.stringify(res.body));
    return res;
  };

  const admin = (await createUserWithToken('ADMIN')).auth;
  record(
    await request(app)
      .post('/auth/signup')
      .send({ name: 'Asha', email: 'asha@example.com', password: 'password123' }),
  );
  const login = record(
    await request(app)
      .post('/auth/login')
      .send({ email: 'asha@example.com', password: 'password123' }),
  );
  const user = `Bearer ${login.body.data.accessToken}`;

  const centre = record(
    await request(app)
      .post('/centres')
      .set('Authorization', admin)
      .send({ name: 'HealthFirst', location: 'Bengaluru' }),
  ).body.data;
  const test = record(
    await request(app).post('/tests').set('Authorization', admin).send({ name: 'CBC' }),
  ).body.data;
  record(
    await request(app)
      .post(`/centres/${centre.id}/tests`)
      .set('Authorization', admin)
      .send({ testId: test.id, pricePaise: 35000 }),
  );
  record(await request(app).get('/centres'));
  record(await request(app).get(`/centres/${centre.id}/tests`));

  const booking = record(
    await request(app)
      .post('/bookings')
      .set('Authorization', user)
      .send({
        centreId: centre.id,
        testId: test.id,
        appointmentDateTime: new Date(Date.now() + 7 * DAY).toISOString(),
      }),
  ).body.data;
  record(
    await request(app)
      .post('/payments')
      .set('Authorization', user)
      .send({ bookingId: booking.id, simulateOutcome: 'SUCCESS' }),
  );
  record(await request(app).get('/bookings').set('Authorization', user));
  record(await request(app).get(`/bookings/${booking.id}`).set('Authorization', user));
  // Error responses too.
  record(
    await request(app)
      .post('/auth/login')
      .send({ email: 'asha@example.com', password: 'wrong-pw' }),
  );
  record(await request(app).post('/auth/signup').send({ email: 'x' }));

  expect(bodies).toHaveLength(13);
  for (const body of bodies) expect(body).not.toMatch(SENSITIVE);
});
