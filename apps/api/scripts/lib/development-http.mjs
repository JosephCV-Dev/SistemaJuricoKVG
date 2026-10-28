import { developmentTotp } from './development-identities.mjs';
import { DevelopmentSetupError } from './development-database.mjs';

export class DevelopmentBrowser {
  cookie = '';
  constructor(origin) {
    this.origin = origin;
  }
  async request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(this.origin + '/api/v1/' + path, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(method === 'POST'
          ? {
              Origin: process.env.APP_ORIGIN,
              'Content-Type': 'application/json',
            }
          : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const cookie = response.headers.getSetCookie().at(-1);
    if (cookie) this.cookie = cookie.split(';')[0];
    let data = null;
    if (response.status !== 204) data = await response.json();
    return { status: response.status, data, headers: response.headers };
  }
  async mutate(path, data) {
    const csrf = await this.request('auth/csrf');
    if (csrf.status !== 200)
      throw new DevelopmentSetupError('No se pudo preparar CSRF de prueba.');
    return this.request(path, 'POST', data, {
      'X-CSRF-Token': csrf.data.csrfToken,
    });
  }
  async login(account) {
    const first = await this.mutate('auth/login', {
      email: account.email,
      password: account.password,
    });
    if (
      first.status !== 200 ||
      first.data.status !== 'mfa_required' ||
      !account.factorId ||
      !account.totpSecret
    )
      throw new DevelopmentSetupError(
        'La cuenta ficticia necesita preparación de MFA.',
      );
    const verified = await this.mutate('auth/mfa/verify', {
      factorId: account.factorId,
      code: developmentTotp(account.totpSecret),
    });
    if (verified.status !== 200 || verified.data.status !== 'authenticated')
      throw new DevelopmentSetupError(
        'No se completó la autenticación real de prueba.',
      );
    return verified.data;
  }
}
