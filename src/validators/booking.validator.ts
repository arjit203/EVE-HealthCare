import { z } from 'zod';

export const createBookingSchema = z.strictObject({
  centreId: z.uuid('centreId must be a valid UUID'),
  testId: z.uuid('testId must be a valid UUID'),
  // ISO 8601 with an explicit timezone ("Z" or "+05:30"), so the instant is unambiguous.
  appointmentDateTime: z.iso
    .datetime({ offset: true, message: 'appointmentDateTime must be ISO 8601 with a timezone' })
    .transform((value) => new Date(value))
    .refine((date) => date.getTime() > Date.now(), 'appointmentDateTime must be in the future'),
});
// strictObject: unknown fields (e.g. "amount" or "status") are rejected with 400 instead of being
// silently ignored — the amount always comes from the offering price, never from the client.

export const bookingIdParamsSchema = z.object({
  id: z.uuid('Booking id must be a valid UUID'),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
