import { Router } from 'express';
import { authRouter } from './auth.routes';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ data: { status: 'ok' } });
});

router.use('/auth', authRouter);
