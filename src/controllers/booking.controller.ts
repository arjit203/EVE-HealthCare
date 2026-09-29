import type { Request, Response } from 'express';
import { bookingService } from '../services/booking.service';

// Every booking route runs behind `authenticate`, so req.user is always set here.
type BookingParams = { id: string };

export const bookingController = {
  async create(req: Request, res: Response) {
    const booking = await bookingService.create(req.user!.id, req.body);
    res.status(201).json({ data: booking });
  },

  async list(req: Request, res: Response) {
    const bookings = await bookingService.listForUser(req.user!.id);
    res.json({ data: bookings });
  },

  async getById(req: Request<BookingParams>, res: Response) {
    const booking = await bookingService.getForUser(req.user!.id, req.params.id);
    res.json({ data: booking });
  },

  async cancel(req: Request<BookingParams>, res: Response) {
    const booking = await bookingService.cancel(req.user!.id, req.params.id);
    res.json({ data: booking });
  },
};
