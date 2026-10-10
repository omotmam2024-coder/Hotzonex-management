type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, details?: Record<string, unknown>): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const suffix = details && Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  if (level === 'error') console.error(line + suffix);
  else if (level === 'warn') console.warn(line + suffix);
  else console.log(line + suffix);
}

/** Plain console logger. Never pass router passwords or keys in `details`. */
export const log = {
  info: (message: string, details?: Record<string, unknown>) => write('info', message, details),
  warn: (message: string, details?: Record<string, unknown>) => write('warn', message, details),
  error: (message: string, details?: Record<string, unknown>) => write('error', message, details),
};
