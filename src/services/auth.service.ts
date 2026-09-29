import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { userRepository } from '../repositories/user.repository';
import { AppError } from '../utils/AppError';
import { signAccessToken } from '../utils/jwt';
import { hashPassword, verifyPassword } from '../utils/password';
import type { LoginInput, SignupInput } from '../validators/auth.validator';
import type { PublicUser } from '../types/auth';

const emailTaken = () =>
  new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'Email is already registered');

// Compared against when the email does not exist, so a login for an unknown email
// takes about as long as one with a wrong password (avoids revealing which emails exist).
const DUMMY_HASH = '$2b$10$wqXUTnRMBSPaaqvJBPhVv.Yau/PyqiHm9A9Rz/PKFFKdU4xvzPJni';

export const authService = {
  async signup(input: SignupInput): Promise<PublicUser> {
    if (await userRepository.existsByEmail(input.email)) throw emailTaken();

    const passwordHash = await hashPassword(input.password);

    try {
      // Only these fields are passed, so a "role" in the request body can never reach the
      // database (Zod has already stripped it); the column default makes every signup a USER.
      return await userRepository.create({ name: input.name, email: input.email, passwordHash });
    } catch (err) {
      // Two concurrent signups with the same email can both pass the check above;
      // the database unique constraint catches the second one.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw emailTaken();
      }
      throw err;
    }
  },

  async login(input: LoginInput) {
    const user = await userRepository.findByEmailWithPassword(input.email);
    const passwordMatches = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);

    // Same error for unknown email and wrong password.
    if (!user || !passwordMatches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const publicUser: PublicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    };

    return {
      accessToken: signAccessToken({ id: user.id, email: user.email, role: user.role }),
      tokenType: 'Bearer',
      expiresIn: env.JWT_EXPIRES_IN,
      user: publicUser,
    };
  },
};
