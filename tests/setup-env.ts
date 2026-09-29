import dotenv from 'dotenv';

// Tests run against a separate database configured in .env.test.
dotenv.config({ path: '.env.test', override: true, quiet: true });
process.env.NODE_ENV = 'test';
