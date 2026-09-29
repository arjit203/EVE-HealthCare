import { z } from 'zod';

// Upper bound keeps prices well inside PostgreSQL INTEGER range. 1,00,00,000 paise = Rs 1,00,000.
export const MAX_PRICE_PAISE = 10_000_000;

const pricePaise = z
  .int('pricePaise must be an integer number of paise')
  .positive('pricePaise must be greater than 0')
  .max(MAX_PRICE_PAISE, `pricePaise must be at most ${MAX_PRICE_PAISE}`);

export const createCentreSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  location: z.string().trim().min(1, 'Location is required').max(300),
});

export const centreIdParamsSchema = z.object({
  centreId: z.uuid('centreId must be a valid UUID'),
});

export const offeringParamsSchema = z.object({
  centreId: z.uuid('centreId must be a valid UUID'),
  testId: z.uuid('testId must be a valid UUID'),
});

export const createOfferingSchema = z.object({
  testId: z.uuid('testId must be a valid UUID'),
  pricePaise,
});

export const updateOfferingSchema = z.object({ pricePaise });

export type CreateCentreInput = z.infer<typeof createCentreSchema>;
export type CreateOfferingInput = z.infer<typeof createOfferingSchema>;
export type UpdateOfferingInput = z.infer<typeof updateOfferingSchema>;
