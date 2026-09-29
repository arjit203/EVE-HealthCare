import { prisma } from '../config/prisma';

export const diagnosticTestRepository = {
  create(data: { name: string; description?: string }) {
    return prisma.diagnosticTest.create({ data });
  },

  findAll() {
    return prisma.diagnosticTest.findMany({ orderBy: { name: 'asc' } });
  },

  findById(id: string) {
    return prisma.diagnosticTest.findUnique({ where: { id } });
  },
};
