export interface AuthUser {
  id: string;
  name: string;
  roles: string[];
}

export interface AuthFactor {
  id: string;
  friendlyName: string;
}

export type AuthState =
  | { status: 'anonymous' }
  | {
      status: 'mfa_required';
      factors: AuthFactor[];
      enrollmentRequired: boolean;
    }
  | {
      status: 'authenticated';
      user: AuthUser;
      expiresAt: string;
      idleTimeoutSeconds: number;
    };

export interface LoginRequest {
  email: string;
  password: string;
}

export interface MfaVerifyRequest {
  factorId: string;
  code: string;
}

export interface MfaEnrollmentResponse {
  factorId: string;
  qrCode: string | null;
  secret: string;
}

export interface CsrfResponse {
  csrfToken: string;
}
