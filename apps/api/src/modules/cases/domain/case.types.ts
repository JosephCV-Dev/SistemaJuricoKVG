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
