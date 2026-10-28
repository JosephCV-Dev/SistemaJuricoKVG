export interface ProviderTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  authUserId: string;
}

export interface MfaFactor {
  id: string;
  friendlyName: string;
}

export interface Authentication extends ProviderTokens {
  phase: 'mfa' | 'authenticated';
  absoluteExpiresAt: number;
  pendingFactorId?: string;
}

export interface IdentityContext {
  user: { id: string; name: string; roles: string[] };
  capabilities: Array<{
    permission: string;
    context: string;
    requiresMfa: boolean;
    requiresDecision: boolean;
  }>;
  expiresAt: string;
  idleTimeoutSeconds: number;
}
