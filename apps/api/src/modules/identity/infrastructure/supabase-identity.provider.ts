import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  isAuthError,
  isAuthRetryableFetchError,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { Environment } from '../../../config/environment';
import { IdentityProvider } from '../application/identity.ports';
import type { ProviderTokens } from '../domain/identity.types';

@Injectable()
export class SupabaseIdentityProvider extends IdentityProvider {
  constructor(private readonly config: ConfigService<Environment>) {
    super();
  }

  private client(): SupabaseClient {
    const url = this.config.get('SUPABASE_URL', { infer: true });
    const key = this.config.get('SUPABASE_PUBLISHABLE_KEY', { infer: true });
    if (!url || !key)
      throw new ServiceUnavailableException('El acceso no está configurado.');
    return createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: { retry: false },
      global: {
        fetch: (input, options) =>
          fetch(input, {
            ...options,
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
          }),
      },
    });
  }

  private tokens(session: Session | null): ProviderTokens {
    if (
      !session?.access_token ||
      !session.refresh_token ||
      !session.expires_at ||
      !session.user.id
    ) {
      throw new UnauthorizedException('No fue posible completar el acceso.');
    }
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at * 1000,
      authUserId: session.user.id,
    };
  }

  private async resume(
    tokens: ProviderTokens,
  ): Promise<{ client: SupabaseClient; tokens: ProviderTokens }> {
    // prepare() owns explicit refresh and its persistence under the session lock.
    // Do not let setSession() silently rotate a token that expired mid-operation.
    let jwtExpiresAt: number;
    try {
      const segments = tokens.accessToken.split('.');
      if (segments.length !== 3 || !segments[1]) throw new Error();
      const payload: unknown = JSON.parse(
        Buffer.from(segments[1], 'base64url').toString('utf8'),
      );
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('exp' in payload) ||
        typeof payload.exp !== 'number' ||
        !Number.isFinite(payload.exp)
      )
        throw new Error();
      // Only a refresh deadline hint; getUser still verifies identity remotely.
      jwtExpiresAt = payload.exp * 1000;
    } catch {
      throw new UnauthorizedException('La sesión no es válida o ha vencido.');
    }
    if (Math.min(tokens.expiresAt, jwtExpiresAt) <= Date.now() + 150_000) {
      throw new ServiceUnavailableException(
        'La sesión necesita renovarse. Vuelve a intentar la operación.',
      );
    }
    const client = this.client();
    const result = await client.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (result.error) {
      throwIdentityError(result.error, 'La sesión no es válida o ha vencido.');
    }
    if (
      !result.data.session ||
      result.data.session.user.id !== tokens.authUserId
    ) {
      throw new UnauthorizedException('La sesión no es válida o ha vencido.');
    }
    return { client, tokens: this.tokens(result.data.session) };
  }

  async signIn(email: string, password: string): Promise<ProviderTokens> {
    const result = await this.client().auth.signInWithPassword({
      email,
      password,
    });
    if (result.error)
      throwIdentityError(
        result.error,
        'No fue posible iniciar sesión con los datos indicados.',
      );
    return this.tokens(result.data.session);
  }

  async refresh(tokens: ProviderTokens): Promise<ProviderTokens> {
    const result = await this.client().auth.refreshSession({
      refresh_token: tokens.refreshToken,
    });
    if (result.error) {
      throwIdentityError(result.error, 'La sesión no es válida o ha vencido.');
    }
    if (result.data.session?.user.id !== tokens.authUserId) {
      throw new UnauthorizedException('La sesión no es válida o ha vencido.');
    }
    return this.tokens(result.data.session);
  }

  async verifyIdentity(tokens: ProviderTokens): Promise<void> {
    const result = await this.client().auth.getUser(tokens.accessToken);
    if (result.error) {
      throwIdentityError(result.error, 'La sesión no es válida o ha vencido.');
    }
    if (result.data.user?.id !== tokens.authUserId) {
      throw new UnauthorizedException('La sesión no es válida o ha vencido.');
    }
  }

  async factors(tokens: ProviderTokens) {
    const current = await this.resume(tokens);
    const result = await current.client.auth.mfa.listFactors();
    if (result.error)
      throwIdentityError(
        result.error,
        'No fue posible verificar el segundo factor.',
      );
    return {
      tokens: current.tokens,
      factors: result.data.totp
        .filter((factor) => factor.status === 'verified')
        .map((factor) => ({
          id: factor.id,
          friendlyName: factor.friendly_name || 'Aplicación de autenticación',
        })),
    };
  }

  async enroll(tokens: ProviderTokens, previousFactorId?: string) {
    const current = await this.resume(tokens);
    if (previousFactorId) {
      const factors = await current.client.auth.mfa.listFactors();
      if (factors.error) {
        throwIdentityError(
          factors.error,
          'No fue posible preparar el segundo factor.',
        );
      }
      const previous = factors.data?.all.find(
        (factor) =>
          factor.id === previousFactorId && factor.status === 'unverified',
      );
      if (previous) {
        const removal = await current.client.auth.mfa.unenroll({
          factorId: previousFactorId,
        });
        if (removal.error) {
          throwIdentityError(
            removal.error,
            'No fue posible preparar el segundo factor.',
          );
        }
      }
    }
    const result = await current.client.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'Sistema Jurídico KVG',
    });
    if (result.error) {
      throwIdentityError(
        result.error,
        'No fue posible preparar el segundo factor.',
      );
    }
    if (!result.data)
      throw new UnauthorizedException(
        'No fue posible preparar el segundo factor.',
      );
    return {
      tokens: current.tokens,
      factorId: result.data.id,
      qrCode: result.data.totp.qr_code,
      secret: result.data.totp.secret,
    };
  }

  async verifyMfa(
    tokens: ProviderTokens,
    factorId: string,
    code: string,
  ): Promise<ProviderTokens> {
    const current = await this.resume(tokens);
    const factors = await current.client.auth.mfa.listFactors();
    if (factors.error) {
      throwIdentityError(
        factors.error,
        'No fue posible verificar el segundo factor.',
      );
    }
    if (
      !factors.data.all.some(
        (factor) => factor.id === factorId && factor.factor_type === 'totp',
      )
    ) {
      throw new UnauthorizedException(
        'No fue posible verificar el segundo factor.',
      );
    }
    const result = await current.client.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (result.error) {
      throwIdentityError(
        result.error,
        'El código del segundo factor no es válido o ha vencido.',
        'bad-request',
      );
    }
    if (!result.data)
      throw new BadRequestException(
        'El código del segundo factor no es válido o ha vencido.',
      );
    const session = await current.client.auth.getSession();
    if (session.error) {
      throwIdentityError(session.error, 'La sesión no es válida o ha vencido.');
    }
    const next = this.tokens(session.data.session);
    if (next.authUserId !== tokens.authUserId)
      throw new UnauthorizedException('No fue posible completar el acceso.');
    await this.verifyIdentity(next);
    return next;
  }

  async signOut(tokens: ProviderTokens): Promise<void> {
    const current = await this.resume(tokens);
    const result = await current.client.auth.signOut({ scope: 'local' });
    if (result.error)
      throwIdentityError(
        result.error,
        'No fue posible completar la revocación remota.',
        'revocation',
      );
  }
}

function throwIdentityError(
  error: unknown,
  rejectionMessage: string,
  rejection: 'unauthorized' | 'bad-request' | 'revocation' = 'unauthorized',
): never {
  if (
    isAuthRetryableFetchError(error) ||
    (isAuthError(error) &&
      (error.status === 0 ||
        error.status === 408 ||
        error.status === 429 ||
        (typeof error.status === 'number' && error.status >= 500) ||
        error.name === 'AuthUnknownError'))
  ) {
    throw new ServiceUnavailableException(
      'El servicio de identidad no está disponible temporalmente.',
    );
  }
  if (rejection === 'bad-request')
    throw new BadRequestException(rejectionMessage);
  if (rejection === 'revocation')
    throw new ServiceUnavailableException(rejectionMessage);
  throw new UnauthorizedException(rejectionMessage);
}
