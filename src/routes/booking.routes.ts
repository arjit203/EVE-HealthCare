import { Router } from 'express';
import { bookingController } from '../controllers/booking.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { bookingIdParamsSchema, createBookingSchema } from '../validators/booking.validator';

export const bookingRouter = Router();

// Every booking route requires a logged-in user. Users (including admins) only ever see their own
// bookings; ownership is enforced in the queries themselves.
bookingRouter.use(authenticate);

bookingRouter.post('/', validate({ body: createBookingSchema }), bookingController.create);
bookingRouter.get('/', bookingController.list);
bookingRouter.get('/:id', validate({ params: bookingIdParamsSchema }), bookingController.getById);
bookingRouter.patch(
  '/:id/cancel',
  validate({ params: bookingIdParamsSchema }),
  bookingController.cancel,
);
