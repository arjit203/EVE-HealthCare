/**
 * Minimal structured logger: one JSON object per line, so logs are easy to search and parse.
 * info/warn are silent under NODE_ENV=test to keep test output readable (tests can spy on these
 * methods); errors are always printed so unexpected failures are never hidden.
 */
const write = (level: 'info' | 'warn' | 'error', message: string, meta: object = {}) => {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...meta });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export const logger = {
  info: (message: string, meta?: object) => write('info', message, meta),
  warn: (message: string, meta?: object) => write('warn', message, meta),
  error: (message: string, meta?: object) => write('error', message, meta),
};
