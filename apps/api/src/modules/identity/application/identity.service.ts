import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthState } from '@kvg/contracts';
import { IdentityProvider, OperationalSession } from './identity.ports';
import type { Authentication, IdentityContext } from '../domain/identity.types';

type PersistRefreshedAuthentication = (
  authentication: Authentication,
) => Promise<void>;

@Injectable()
export class IdentityService {
  constructor(
    private readonly provider: IdentityProvider,
    private readonly operational: OperationalSession,
  ) {}

  async login(email: string, password: string): Promise<Authentication> {
    const tokens = await this.provider.signIn(email, password);
    return {
      ...tokens,
      phase: 'mfa',
      absoluteExpiresAt: Date.now() + 10 * 60_000,
    };
  }

  async prepare(
    authentication: Authentication,
    forceRefresh = false,
    persistRefreshed?: PersistRefreshedAuthentication,
  ): Promise<Authentication> {
    if (authentication.absoluteExpiresAt <= Date.now())
      throw new UnauthorizedException('La sesión ha vencido.');
    const shouldRefresh =
      // Margen para completar las consultas acotadas de MFA sin que el SDK
      // renueve implícitamente la sesión dentro de su ventana de expiración.
      forceRefresh || authentication.expiresAt <= Date.now() + 180_000;
    const tokens = shouldRefresh
      ? await this.provider.refresh(authentication)
      : authentication;
    if (tokens.authUserId !== authentication.authUserId)
      throw new UnauthorizedException('La sesión no es válida.');
    const current = { ...authentication, ...tokens };
    // El proveedor puede rotar un refresh token de un solo uso. Se persiste antes
    // de otra consulta remota para conservarlo aunque esa consulta devuelva 503.
    if (shouldRefresh) await persistRefreshed?.(current);
    await this.provider.verifyIdentity(current);
    return current;
  }

  async state(
    authentication: Authentication,
    persistRefreshed?: PersistRefreshedAuthentication,
  ): Promise<{
    authentication: Authentication;
    state: AuthState;
    context?: IdentityContext;
  }> {
    const current = await this.prepare(authentication, false, persistRefreshed);
    if (current.phase === 'mfa') {
      const result = await this.provider.factors(current);
      return {
        authentication: { ...current, ...result.tokens },
        state: {
          status: 'mfa_required',
          factors: result.factors,
          enrollmentRequired: result.factors.length === 0,
        },
      };
    }
    const context = await this.operational.current(current.accessToken);
    return {
      authentication: {
        ...current,
        absoluteExpiresAt: Math.min(
          current.absoluteExpiresAt,
          Date.parse(context.expiresAt),
        ),
      },
      context,
      state: {
        status: 'authenticated',
        user: context.user,
        expiresAt: context.expiresAt,
        idleTimeoutSeconds: context.idleTimeoutSeconds,
      },
    };
  }

  async enroll(
    authentication: Authentication,
    persistRefreshed?: PersistRefreshedAuthentication,
  ) {
    const current = await this.prepare(authentication, false, persistRefreshed);
    if (current.phase !== 'mfa')
      throw new ForbiddenException(
        'Esta operación no está disponible para la sesión actual.',
      );
    const factors = await this.provider.factors(current);
    if (factors.factors.length)
      throw new ForbiddenException('Verifica el factor existente.');
    const enrollment = await this.provider.enroll(
      { ...current, ...factors.tokens },
      current.pendingFactorId,
    );
    return {
      authentication: {
        ...current,
        ...enrollment.tokens,
        pendingFactorId: enrollment.factorId,
      },
      enrollment: {
        factorId: enrollment.factorId,
        qrCode: enrollment.qrCode,
        secret: enrollment.secret,
      },
    };
  }

  async verify(
    authentication: Authentication,
    factorId: string,
    code: string,
    persistRefreshed?: PersistRefreshedAuthentication,
  ) {
    const current = await this.prepare(authentication, false, persistRefreshed);
    if (current.phase !== 'mfa')
      throw new ForbiddenException('La sesión ya completó el segundo factor.');
    const tokens = await this.provider.verifyMfa(current, factorId, code);
    try {
      await this.operational.start(tokens.accessToken);
      const context = await this.operational.current(tokens.accessToken);
      const authenticated: Authentication = {
        ...tokens,
        phase: 'authenticated',
        absoluteExpiresAt: Date.parse(context.expiresAt),
      };
      return {
        authentication: authenticated,
        context,
        state: {
          status: 'authenticated',
          user: context.user,
          expiresAt: context.expiresAt,
          idleTimeoutSeconds: context.idleTimeoutSeconds,
        } as AuthState,
      };
    } catch (error) {
      await this.provider.signOut(tokens).catch(() => undefined);
      throw error;
    }
  }

  async logout(authentication: Authentication): Promise<void> {
    let failure: unknown;
    let current = authentication;
    try {
      current = await this.prepare(authentication);
      if (current.phase === 'authenticated')
        await this.operational.close(current.accessToken);
    } catch (error) {
      if (
        !(error instanceof UnauthorizedException) &&
        !(error instanceof ForbiddenException)
      )
        failure = error;
    }
    try {
      await this.provider.signOut(current);
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw failure;
  }
}
