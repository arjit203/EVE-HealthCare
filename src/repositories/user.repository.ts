import { prisma } from '../config/prisma';

// Columns that are safe to return from the API (no passwordHash).
const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} as const;

export const userRepository = {
  // Includes passwordHash: only for verifying credentials, never for responses.
  findByEmailWithPassword(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  existsByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, select: { id: true } }).then(Boolean);
  },

  create(data: { name: string; email: string; passwordHash: string }) {
    return prisma.user.create({ data, select: publicUserSelect });
  },
};
