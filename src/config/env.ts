import 'dotenv/config';
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  // A number of seconds, or a number with a unit ("15m", "1h", "7d"). Checked here because an
  // invalid value would otherwise only fail at the first login, with a 500.
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]?$/, 'JWT_EXPIRES_IN must look like 3600, 15m, 1h or 7d')
    .default('1h'),
  WEBHOOK_SECRET: z.string().min(8),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast on startup instead of failing later on the first request.
  console.error('Invalid environment configuration:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
