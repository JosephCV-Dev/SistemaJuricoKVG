export class AuthRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthRequestError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maxLength = 512): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maxLength
  );
}

function invalidResponse(): never {
  throw new Error('La respuesta de acceso tiene un formato inesperado.');
}

export async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    let message = 'No fue posible completar la operación de acceso.';

    try {
      const body: unknown = await response.json();

      if (isRecord(body)) {
        if (isText(body.message, 500)) {
          message = body.message;
        } else if (
          Array.isArray(body.message) &&
          body.message.length <= 10 &&
          body.message.every((item: unknown) => isText(item, 200))
        ) {
          message = body.message.join(' ');
        }
      }
    } catch {
      // Un error sin JSON conserva el mensaje público genérico.
    }

    throw new AuthRequestError(message, response.status);
  }

  try {
    return await response.json();
  } catch {
    return invalidResponse();
  }
}

export async function getJson(
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  return readJson(
    await fetch(path, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    }),
  );
}

export async function mutate(
  path: string,
  body: object,
  signal: AbortSignal,
): Promise<Response> {
  // El servidor puede rotar el token tras login o MFA; no se conserva entre cambios.
  const csrf = await getJson('/api/v1/auth/csrf', signal);

  if (!isRecord(csrf) || !isText(csrf.csrfToken, 4096)) {
    return invalidResponse();
  }

  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.csrfToken,
    },
    body: JSON.stringify(body),
    signal,
  });
}
