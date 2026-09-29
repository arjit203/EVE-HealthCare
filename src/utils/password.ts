import bcrypt from 'bcryptjs';

// Cost factor: each +1 doubles the hashing time. 10 is the common default.
const SALT_ROUNDS = 10;

export const hashPassword = (password: string) => bcrypt.hash(password, SALT_ROUNDS);

export const verifyPassword = (password: string, passwordHash: string) =>
  bcrypt.compare(password, passwordHash);
