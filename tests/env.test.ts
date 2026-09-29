import { envSchema } from '../src/config/env';

const base = {
  DATABASE_URL: 'postgresql://localhost/x',
  JWT_SECRET: 'a-secret-that-is-long-enough',
  WEBHOOK_SECRET: 'webhook-secret',
};

describe('environment validation', () => {
  it.each(['3600', '15m', '1h', '7d'])('accepts JWT_EXPIRES_IN=%s', (value) => {
    expect(envSchema.safeParse({ ...base, JWT_EXPIRES_IN: value }).success).toBe(true);
  });

  it.each(['abc', '1 hour', '-5m', ''])('rejects JWT_EXPIRES_IN=%s at startup', (value) => {
    expect(envSchema.safeParse({ ...base, JWT_EXPIRES_IN: value }).success).toBe(false);
  });

  it('has no fallback secrets: a missing JWT_SECRET or WEBHOOK_SECRET is rejected', () => {
    expect(envSchema.safeParse({ ...base, JWT_SECRET: undefined }).success).toBe(false);
    expect(envSchema.safeParse({ ...base, WEBHOOK_SECRET: undefined }).success).toBe(false);
  });
});
