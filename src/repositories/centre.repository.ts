import { prisma } from '../config/prisma';

export const centreRepository = {
  create(data: { name: string; location: string }) {
    return prisma.diagnosticCentre.create({ data });
  },

  findAll() {
    return prisma.diagnosticCentre.findMany({ orderBy: { name: 'asc' } });
  },

  findById(id: string) {
    return prisma.diagnosticCentre.findUnique({ where: { id } });
  },
};
