import { Router } from 'express';
import { diagnosticTestController } from '../controllers/diagnosticTest.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { createDiagnosticTestSchema } from '../validators/diagnosticTest.validator';

export const diagnosticTestRouter = Router();

diagnosticTestRouter.get('/', diagnosticTestController.list);
diagnosticTestRouter.post(
  '/',
  authenticate,
  requireAdmin,
  validate({ body: createDiagnosticTestSchema }),
  diagnosticTestController.create,
);
