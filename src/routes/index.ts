import { Router } from 'express';
import { authRouter } from './auth.routes';
import { centreRouter } from './centre.routes';
import { diagnosticTestRouter } from './diagnosticTest.routes';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ data: { status: 'ok' } });
});

router.use('/auth', authRouter);
router.use('/centres', centreRouter);
router.use('/tests', diagnosticTestRouter);
