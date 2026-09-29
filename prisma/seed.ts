import 'dotenv/config';
import { z } from 'zod';
import { prisma } from '../src/config/prisma';
import { hashPassword } from '../src/utils/password';

const adminSchema = z.object({
  ADMIN_NAME: z.string().trim().min(1).default('Admin'),
  ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  ADMIN_PASSWORD: z.string().min(8).max(72),
});

/**
 * Creates the admin account, or resets it if it already exists. Safe to run repeatedly.
 * The password and role are always overwritten so that a normal user who happened to
 * register the admin email first cannot keep control of the account.
 */
export const seedAdmin = async (input: { name: string; email: string; password: string }) => {
  const passwordHash = await hashPassword(input.password);

  return prisma.user.upsert({
    where: { email: input.email },
    create: { name: input.name, email: input.email, passwordHash, role: 'ADMIN' },
    update: { name: input.name, passwordHash, role: 'ADMIN' },
    select: { id: true, email: true, role: true },
  });
};

const main = async () => {
  const env = adminSchema.parse(process.env);
  const admin = await seedAdmin({
    name: env.ADMIN_NAME,
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
  });
  console.log(`Seeded admin: ${admin.email}`);
};

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
