import { prisma } from '../config/prisma';

// Every offering is returned together with the test it refers to.
const withTest = {
  test: { select: { id: true, name: true, description: true } },
} as const;

export const offeringRepository = {
  create(data: { centreId: string; testId: string; pricePaise: number }) {
    return prisma.centreTestOffering.create({ data, include: withTest });
  },

  findByCentre(centreId: string) {
    return prisma.centreTestOffering.findMany({
      where: { centreId },
      include: withTest,
      orderBy: { test: { name: 'asc' } },
    });
  },

  findByCentreAndTest(centreId: string, testId: string) {
    return prisma.centreTestOffering.findUnique({
      where: { centreId_testId: { centreId, testId } },
    });
  },

  updatePrice(id: string, pricePaise: number) {
    return prisma.centreTestOffering.update({
      where: { id },
      data: { pricePaise },
      include: withTest,
    });
  },
};
