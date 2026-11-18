export interface CaseUpdate {
  revision: number;
  reason:
    | 'CORREGIR_CAPTURA'
    | 'PRECISAR_DESCRIPCION'
    | 'ACTUALIZAR_REFERENCIA'
    | 'OTRA_CORRECCION';
  description?: string;
  externalNumber?: string | null;
  externalAuthority?: string | null;
}
export type CaseState =
  'NUEVO' | 'EN_PROCESO' | 'PENDIENTE' | 'CONCLUIDO' | 'ARCHIVADO';
export interface NewCase {
  requestId: string;
  clientId: string;
  description: string;
  externalNumber?: string;
  externalAuthority?: string;
}
export interface CaseRecord {
  id: string;
  folio: string;
  clientId: string;
  description: string;
  status: CaseState;
  externalNumber: string | null;
  externalAuthority: string | null;
  createdAt: string;
  revision: number;
}
export interface CaseInformation extends CaseRecord {
  canAssign: boolean;
  hasActivePrincipal: boolean;
  canAddProgress: boolean;
  transitions: Array<{ status: CaseState; requiresDecision: boolean }>;
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
    authorName: string | null;
    approvalReference: string | null;
  }>;
  progress: Array<{
    id: string;
    description: string;
    at: string;
    authorName: string | null;
    correctsId: string | null;
    occurredOn: string | null;
    source: string | null;
    references: ProgressReference[];
  }>;
}
export interface CaseSearch {
  text?: string;
  client?: string;
  responsible?: string;
  status?: CaseState;
  limit: number;
  offset: number;
}

export type Participation = 'PRINCIPAL' | 'COLABORADOR' | 'EXPLICITO';
export interface AssignedSearch extends CaseSearch {
  from?: string;
  to?: string;
  participation?: Participation;
}
export interface AssignmentChange {
  revision: number;
  lawyerId: string;
  reason: string;
  role: Exclude<Participation, 'EXPLICITO'>;
}
export interface ReassignmentChange {
  revision: number;
  lawyerId: string;
  reason: string;
  approvalReference: string;
  keepCollaborator: boolean;
}

export interface StateChange {
  revision: number;
  status: CaseState;
  reason: string;
  approvalReference?: string;
}
export interface ProgressReference {
  versionId: string;
  documentId: string;
  name: string;
  number: number;
}
export interface ProgressInput {
  requestId: string;
  description: string;
  correctsId?: string;
  occurredOn?: string;
  source?: string;
  versionIds?: string[];
}
