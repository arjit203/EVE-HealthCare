import { env } from './config/env';
import { prisma } from './config/prisma';
import { createApp } from './app';

const server = createApp().listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});

const shutdown = () => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
