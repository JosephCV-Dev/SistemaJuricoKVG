import type {
  MfaFactor,
  ProviderTokens,
  IdentityContext,
} from '../domain/identity.types';

export abstract class IdentityProvider {
  abstract signIn(email: string, password: string): Promise<ProviderTokens>;
  abstract refresh(tokens: ProviderTokens): Promise<ProviderTokens>;
  abstract verifyIdentity(tokens: ProviderTokens): Promise<void>;
  abstract factors(
    tokens: ProviderTokens,
  ): Promise<{ tokens: ProviderTokens; factors: MfaFactor[] }>;
  abstract enroll(
    tokens: ProviderTokens,
    previousFactorId?: string,
  ): Promise<{
    tokens: ProviderTokens;
    factorId: string;
    qrCode: string;
    secret: string;
  }>;
  abstract verifyMfa(
    tokens: ProviderTokens,
    factorId: string,
    code: string,
  ): Promise<ProviderTokens>;
  abstract signOut(tokens: ProviderTokens): Promise<void>;
}

export abstract class OperationalSession {
  abstract start(accessToken: string): Promise<void>;
  abstract current(accessToken: string): Promise<IdentityContext>;
  abstract close(accessToken: string): Promise<void>;
}
