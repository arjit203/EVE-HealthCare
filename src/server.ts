import { env } from './config/env';
import { prisma } from './config/prisma';
import { createApp } from './app';
import { logger } from './utils/logger';

const server = createApp().listen(env.PORT, () => {
  logger.info('Server listening', { port: env.PORT });
});

const shutdown = () => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
