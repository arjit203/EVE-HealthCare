import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createPaymentSchema } from '../validators/payment.validator';

export const paymentRouter = Router();

paymentRouter.post(
  '/',
  authenticate,
  validate({ body: createPaymentSchema }),
  paymentController.create,
);
