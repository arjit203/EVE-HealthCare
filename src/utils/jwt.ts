import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { AppError } from './AppError';
import type { AuthUser } from '../types/auth';

const ALGORITHM = 'HS256';

const invalidToken = () => new AppError(401, 'INVALID_TOKEN', 'Invalid token');

export const signAccessToken = (user: AuthUser): string =>
  jwt.sign({ email: user.email, role: user.role }, env.JWT_SECRET, {
    subject: user.id,
    algorithm: ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });

/** Verifies signature and expiry, returning the user the token was issued for. */
export const verifyAccessToken = (token: string): AuthUser => {
  try {
    // Pinning the algorithm prevents a forged token from choosing a weaker one.
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });

    if (typeof payload === 'string') throw invalidToken();

    const { sub, email, role } = payload;
    if (!sub || typeof email !== 'string' || !Object.values(Role).includes(role)) {
      throw invalidToken();
    }
    return { id: sub, email, role };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Token has expired');
    }
    throw invalidToken();
  }
};
