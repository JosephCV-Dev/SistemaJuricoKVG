export interface IdentificationType {
  code: string;
  name: string;
  unique: boolean;
}

export interface ClientInput {
  requestId: string;
  name: string;
  identifications: Array<{ type: string; value: string }>;
  contacts: Array<{
    type: 'CORREO' | 'TELEFONO';
    value: string;
    label?: string;
    preferred: boolean;
  }>;
}

export interface ClientSummary {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  revision: number;
}

export interface ClientDetail extends ClientSummary {
  identifications: Array<{ type: string; value: string }>;
  contacts: ClientInput['contacts'];
}

export type CaseStatus =
  'NUEVO' | 'EN_PROCESO' | 'PENDIENTE' | 'CONCLUIDO' | 'ARCHIVADO';

export interface CaseInput {
  requestId: string;
  clientId: string;
  description: string;
  externalNumber?: string;
  externalAuthority?: string;
}

export interface CaseSummary {
  id: string;
  folio: string;
  clientId: string;
  description: string;
  status: CaseStatus;
  externalNumber: string | null;
  externalAuthority: string | null;
  createdAt: string;
  revision: number;
}

export interface CaseDetail extends CaseSummary {
  assignments: Array<{
    userId: string;
    name: string;
    function: string;
    active: boolean;
  }>;
  history: Array<{
    from: string | null;
    to: string;
    reason: string;
    at: string;
  }>;
  progress: Array<{ description: string; at: string }>;
}

export interface RecordPage<T> {
  items: T[];
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface SessionCapabilities {
  capabilities: Array<{ permission: string; context: string }>;
}
