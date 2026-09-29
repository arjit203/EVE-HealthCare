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

const CENTRES = [
  { name: 'HealthFirst Diagnostics', location: 'Koramangala, Bengaluru' },
  { name: 'CityCare Labs', location: 'Andheri West, Mumbai' },
  { name: 'Apex Imaging Centre', location: 'Connaught Place, New Delhi' },
];

const TESTS = [
  {
    name: 'Complete Blood Count (CBC)',
    description: 'Measures red cells, white cells and platelets.',
  },
  {
    name: 'Lipid Profile',
    description: 'Cholesterol and triglyceride levels. 10–12 hour fast required.',
  },
  { name: 'Thyroid Profile (T3, T4, TSH)', description: 'Checks thyroid hormone levels.' },
  { name: 'HbA1c', description: 'Average blood sugar over the last 2–3 months.' },
  { name: 'MRI Brain', description: 'Magnetic resonance imaging of the brain.' },
];

// [centre index, test index, price in paise]. The same test deliberately has a different
// price at each centre, because price belongs to the offering, not to the test.
const OFFERINGS: [number, number, number][] = [
  [0, 0, 35000], // CBC: Rs 350 in Bengaluru
  [1, 0, 42000], // CBC: Rs 420 in Mumbai
  [2, 0, 39900], // CBC: Rs 399 in Delhi
  [0, 1, 80000],
  [1, 1, 95000],
  [0, 2, 55000],
  [1, 2, 49900],
  [1, 3, 45000],
  [2, 3, 52500],
  [2, 4, 750000], // MRI only at the imaging centre: Rs 7,500
];

/** Upserts demo centres, tests and offerings. Safe to run repeatedly. */
export const seedCatalogue = async () => {
  const centres = await Promise.all(
    CENTRES.map((c) =>
      prisma.diagnosticCentre.upsert({
        where: { name_location: c },
        create: c,
        update: {},
      }),
    ),
  );
  const tests = await Promise.all(
    TESTS.map((t) =>
      prisma.diagnosticTest.upsert({ where: { name: t.name }, create: t, update: t }),
    ),
  );

  for (const [centreIndex, testIndex, pricePaise] of OFFERINGS) {
    const centreId = centres[centreIndex].id;
    const testId = tests[testIndex].id;
    await prisma.centreTestOffering.upsert({
      where: { centreId_testId: { centreId, testId } },
      create: { centreId, testId, pricePaise },
      update: { pricePaise },
    });
  }

  return { centres: centres.length, tests: tests.length, offerings: OFFERINGS.length };
};

const main = async () => {
  const env = adminSchema.parse(process.env);
  const admin = await seedAdmin({
    name: env.ADMIN_NAME,
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
  });
  console.log(`Seeded admin: ${admin.email}`);

  const catalogue = await seedCatalogue();
  console.log(
    `Seeded ${catalogue.centres} centres, ${catalogue.tests} tests, ${catalogue.offerings} offerings`,
  );
};

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
