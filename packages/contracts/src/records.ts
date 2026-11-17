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

export interface ClientUpdateInput extends Partial<
  Omit<ClientInput, 'requestId'>
> {
  revision: number;
}

export interface ClientSummary {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  revision: number;
}

export interface ClientDetail extends ClientSummary {
  canEdit: boolean;
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

export type CaseUpdateReason =
  | 'CORREGIR_CAPTURA'
  | 'PRECISAR_DESCRIPCION'
  | 'ACTUALIZAR_REFERENCIA'
  | 'OTRA_CORRECCION';

export interface CaseUpdateInput {
  revision: number;
  reason: CaseUpdateReason;
  description?: string;
  externalNumber?: string | null;
  externalAuthority?: string | null;
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
  canAssign: boolean;
  canEdit: boolean;
  clientName: string | null;
  assignments: Array<{
    userId: string;
    name: string;
    function: string;
    active: boolean;
    startsAt: string;
    endsAt: string | null;
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

export type CaseAssignmentRole = 'PRINCIPAL' | 'COLABORADOR';
export type CaseParticipation = CaseAssignmentRole | 'EXPLICITO';
export interface CaseAssignment {
  id: string;
  userId: string;
  name: string;
  role: CaseAssignmentRole;
  startsAt: string;
  endsAt: string | null;
}
export interface CaseLawyer {
  id: string;
  name: string;
}
export interface CaseAssignmentInput {
  revision: number;
  lawyerId: string;
  reason: string;
  role: CaseAssignmentRole;
}
export interface CaseReassignmentInput {
  revision: number;
  lawyerId: string;
  reason: string;
  approvalReference: string;
  keepCollaborator: boolean;
}
export interface CaseAssignmentResult {
  assignmentId: string;
  caseId: string;
  revision: number;
}
export interface CaseAssignmentSummary {
  id: string;
  folio: string;
  status: CaseStatus;
}
export interface CaseTeam extends CaseAssignmentSummary {
  revision: number;
  assignments: CaseAssignment[];
  lawyers: RecordPage<CaseLawyer>;
}
export interface AssignedCase extends CaseSummary {
  participation: CaseParticipation[];
}
