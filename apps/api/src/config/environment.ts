export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  API_HOST: string;
  API_PORT: number;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const nodeEnv = input.NODE_ENV ?? 'development';
  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error('NODE_ENV debe ser development, test o production.');
  }

  const rawPort = String(input.API_PORT ?? '3000');
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('API_PORT debe ser un entero entre 1 y 65535.');
  }

  const host = input.API_HOST ?? '127.0.0.1';
  if (typeof host !== 'string' || host.trim().length === 0) {
    throw new Error('API_HOST debe contener una dirección válida.');
  }

  return { NODE_ENV: nodeEnv, API_HOST: host, API_PORT: port };
}
