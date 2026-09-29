import type { Role } from '@prisma/client';
import { signAccessToken } from '../../src/utils/jwt';
import { prisma } from './db';

let counter = 0;

/**
 * Inserts a real user with the given role and returns an "Authorization" header value for it.
 * (The password hash is a placeholder: these users never log in through the API.)
 */
export const createUserWithToken = async (role: Role = 'USER') => {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      name: `${role} ${counter}`,
      email: `${role.toLowerCase()}${counter}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
    },
  });
  return { user, auth: `Bearer ${signAccessToken(user)}` };
};
