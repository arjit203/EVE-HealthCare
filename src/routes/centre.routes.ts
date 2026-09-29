import { Router } from 'express';
import { centreController } from '../controllers/centre.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import {
  centreIdParamsSchema,
  createCentreSchema,
  createOfferingSchema,
  offeringParamsSchema,
  updateOfferingSchema,
} from '../validators/centre.validator';

export const centreRouter = Router();

// Reads are public; every write is admin-only (authenticate → 401, requireAdmin → 403).
const adminOnly = [authenticate, requireAdmin];

centreRouter.get('/', centreController.list);
centreRouter.post('/', adminOnly, validate({ body: createCentreSchema }), centreController.create);

centreRouter.get(
  '/:centreId',
  validate({ params: centreIdParamsSchema }),
  centreController.getById,
);

centreRouter.get(
  '/:centreId/tests',
  validate({ params: centreIdParamsSchema }),
  centreController.listOfferings,
);
centreRouter.post(
  '/:centreId/tests',
  adminOnly,
  validate({ params: centreIdParamsSchema, body: createOfferingSchema }),
  centreController.addOffering,
);
centreRouter.patch(
  '/:centreId/tests/:testId',
  adminOnly,
  validate({ params: offeringParamsSchema, body: updateOfferingSchema }),
  centreController.updateOfferingPrice,
);
