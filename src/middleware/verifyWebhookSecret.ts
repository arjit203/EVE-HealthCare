import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

// Hashing both values first gives equal-length buffers, which timingSafeEqual requires, without
// revealing the secret's length.
const digest = (value: string) => createHash('sha256').update(value).digest();
const expected = digest(env.WEBHOOK_SECRET);

/**
 * Only the payment provider knows WEBHOOK_SECRET. Without this check anyone could POST a fake
 * "SUCCESS" event and confirm any booking. timingSafeEqual takes the same time whether the first
 * or the last character differs, so the secret can't be guessed by measuring response times.
 */
export const verifyWebhookSecret: RequestHandler = (req, _res, next) => {
  const provided = req.header('X-Webhook-Secret');
  if (!provided || !timingSafeEqual(digest(provided), expected)) {
    throw new AppError(401, 'INVALID_WEBHOOK_SECRET', 'Missing or invalid webhook secret');
  }
  next();
};
