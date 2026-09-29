import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { verifyWebhookSecret } from '../middleware/verifyWebhookSecret';
import { createPaymentSchema, paymentWebhookSchema } from '../validators/payment.validator';

export const paymentRouter = Router();

paymentRouter.post(
  '/',
  authenticate,
  validate({ body: createPaymentSchema }),
  paymentController.create,
);

// Called by the payment provider, not by users: authenticated by a shared secret, not a JWT.
// (Express matches both /payments/webhook and /payments/webhook/.)
paymentRouter.post(
  '/webhook',
  verifyWebhookSecret,
  validate({ body: paymentWebhookSchema }),
  paymentController.webhook,
);
