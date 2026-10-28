import type {
  AuthFactor,
  AuthState,
  LoginRequest,
  MfaEnrollmentResponse,
  MfaVerifyRequest,
} from '@kvg/contracts';

const authBase = '/api/v1/auth';

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

function readFactor(value: unknown): AuthFactor {
  if (
    !isRecord(value) ||
    !isText(value.id, 128) ||
    typeof value.friendlyName !== 'string' ||
    value.friendlyName.length > 200
  ) {
    return invalidResponse();
  }

  return { id: value.id, friendlyName: value.friendlyName };
}

function readAuthState(value: unknown): AuthState {
  if (!isRecord(value)) return invalidResponse();

  if (value.status === 'anonymous') return { status: 'anonymous' };

  if (
    value.status === 'mfa_required' &&
    Array.isArray(value.factors) &&
    value.factors.length <= 20 &&
    typeof value.enrollmentRequired === 'boolean'
  ) {
    const factors = value.factors.map(readFactor);

    if (
      new Set(factors.map((factor) => factor.id)).size !== factors.length ||
      (!value.enrollmentRequired && factors.length === 0)
    ) {
      return invalidResponse();
    }

    return {
      status: 'mfa_required',
      factors,
      enrollmentRequired: value.enrollmentRequired,
    };
  }

  if (
    value.status === 'authenticated' &&
    isRecord(value.user) &&
    isText(value.user.id, 128) &&
    isText(value.user.name, 200) &&
    Array.isArray(value.user.roles) &&
    value.user.roles.length <= 64 &&
    value.user.roles.every((role: unknown) => isText(role, 64)) &&
    isText(value.expiresAt, 64) &&
    Number.isFinite(Date.parse(value.expiresAt)) &&
    typeof value.idleTimeoutSeconds === 'number' &&
    Number.isSafeInteger(value.idleTimeoutSeconds) &&
    value.idleTimeoutSeconds > 0
  ) {
    return {
      status: 'authenticated',
      user: {
        id: value.user.id,
        name: value.user.name,
        roles: value.user.roles,
      },
      expiresAt: value.expiresAt,
      idleTimeoutSeconds: value.idleTimeoutSeconds,
    };
  }

  return invalidResponse();
}

async function readJson(response: Response): Promise<unknown> {
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

async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  return readJson(
    await fetch(`${authBase}/${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    }),
  );
}

async function mutate(
  path: string,
  body: object,
  signal: AbortSignal,
): Promise<Response> {
  // El servidor puede rotar el token tras login o MFA; no se conserva entre cambios.
  const csrf = await getJson('csrf', signal);

  if (!isRecord(csrf) || !isText(csrf.csrfToken, 4096)) {
    return invalidResponse();
  }

  return fetch(`${authBase}/${path}`, {
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

export async function getSession(signal: AbortSignal): Promise<AuthState> {
  return readAuthState(await getJson('session', signal));
}

export async function login(
  body: LoginRequest,
  signal: AbortSignal,
): Promise<AuthState> {
  return readAuthState(await readJson(await mutate('login', body, signal)));
}

export async function enrollMfa(
  signal: AbortSignal,
): Promise<MfaEnrollmentResponse> {
  const body = await readJson(await mutate('mfa/enroll', {}, signal));

  if (
    !isRecord(body) ||
    !isText(body.factorId, 128) ||
    !isText(body.qrCode, 200_000) ||
    !isText(body.secret, 512)
  ) {
    return invalidResponse();
  }

  return { factorId: body.factorId, qrCode: body.qrCode, secret: body.secret };
}

export async function verifyMfa(
  body: MfaVerifyRequest,
  signal: AbortSignal,
): Promise<AuthState> {
  return readAuthState(
    await readJson(await mutate('mfa/verify', body, signal)),
  );
}

export async function refreshSession(signal: AbortSignal): Promise<AuthState> {
  return readAuthState(await readJson(await mutate('refresh', {}, signal)));
}

export async function logout(signal: AbortSignal): Promise<void> {
  const response = await mutate('logout', {}, signal);

  if (response.status !== 204) {
    await readJson(response);
    return invalidResponse();
  }
}
