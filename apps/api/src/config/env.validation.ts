export interface AppEnvironment {
  NODE_ENV: string;
  MONGODB_URI: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  API_PORT: number;
  WEB_ORIGIN: string;
}

const REQUIRED_KEYS = ['MONGODB_URI', 'JWT_SECRET'] as const;

/**
 * Fails fast on boot when required configuration is missing, rather than
 * surfacing it later as an obscure runtime error.
 */
export function validateEnvironment(config: Record<string, unknown>): AppEnvironment {
  const missing = REQUIRED_KEYS.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Copy .env.example to .env in the repository root and fill it in.',
    );
  }

  const port = Number(config.PORT ?? config.API_PORT ?? 4732);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT (or API_PORT) must be a positive integer');
  }

  return {
    NODE_ENV: String(config.NODE_ENV ?? 'development'),
    MONGODB_URI: String(config.MONGODB_URI),
    JWT_SECRET: String(config.JWT_SECRET),
    JWT_EXPIRES_IN: String(config.JWT_EXPIRES_IN ?? '7d'),
    API_PORT: port,
    WEB_ORIGIN: String(config.WEB_ORIGIN ?? 'http://localhost:3742'),
  };
}