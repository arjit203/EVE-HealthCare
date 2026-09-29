import express from 'express';
import { router } from './routes';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

export const createApp = () => {
  const app = express();
  // Don't advertise the framework (and its version range) in every response.
  app.disable('x-powered-by');

  app.use(express.json({ limit: '100kb' }));
  app.use(router);
  app.use(notFound);
  app.use(errorHandler);

  return app;
};
