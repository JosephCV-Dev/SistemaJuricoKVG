// Contratos HTTP públicos; importar siempre con `import type`.
// Las entidades de persistencia y los secretos permanecen en el backend.
export interface HealthResponse {
  status: 'ok';
  service: 'kvg-api';
  version: string;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  timestamp: string;
}

export type {
  AuthState,
  AuthUser,
  AuthFactor,
  LoginRequest,
  MfaVerifyRequest,
  MfaEnrollmentResponse,
  CsrfResponse,
} from './identity';

export type {
  IdentificationType,
  ClientInput,
  ClientUpdateInput,
  ClientSummary,
  ClientDetail,
  CaseStatus,
  CaseInput,
  CaseSummary,
  CaseDetail,
  RecordPage,
  SessionCapabilities,
} from './records';

export type * from './documents';
