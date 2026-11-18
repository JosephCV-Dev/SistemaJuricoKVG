import type {
  AuthFactor,
  AuthState,
  LoginRequest,
  MfaEnrollmentResponse,
  MfaVerifyRequest,
} from '@kvg/contracts';

const authBase = '/api/v1/auth';

export { AuthRequestError } from '../../shared/api/session-http.ts';
import {
  getJson as getSessionJson,
  mutate as mutateSession,
  readJson,
} from '../../shared/api/session-http.ts';

const getJson = (path: string, signal: AbortSignal) =>
  getSessionJson(`${authBase}/${path}`, signal);
const mutate = (path: string, body: object, signal: AbortSignal) =>
  mutateSession(`${authBase}/${path}`, body, signal);

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
    !isText(body.secret, 512)
  ) {
    return invalidResponse();
  }

  return {
    factorId: body.factorId,
    qrCode: isText(body.qrCode, 512_000) ? body.qrCode : null,
    secret: body.secret,
  };
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
