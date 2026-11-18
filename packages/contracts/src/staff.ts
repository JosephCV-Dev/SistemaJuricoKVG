import type { RecordPage } from './records';

export type StaffRole = 'SECRETARIA' | 'ABOGADO' | 'ADMINISTRADOR';
export type StaffStatus = 'INVITADO' | 'ACTIVO' | 'DESACTIVADO';
export type PermissionContext =
  | 'PRINCIPAL'
  | 'COLABORADOR'
  | 'EXPLICITO'
  | 'GLOBAL_OPERATIVO'
  | 'REGISTRO_PROPIO';
export interface StaffAccount {
  id: string;
  name: string;
  email: string;
  status: StaffStatus;
  revision: number;
}
export interface StaffAccess {
  id: string;
  caseFolio: string;
  name: string;
  expiresAt: string | null;
  permissions: string[];
}
export interface StaffDetail extends StaffAccount {
  roles: StaffRole[];
  accesses: StaffAccess[];
  requiresReassignment: boolean;
}
export interface StaffRevisionInput {
  revision: number;
  reason: string;
}
export interface ReserveInvitationInput {
  requestId: string;
  name: string;
  email: string;
  reason: string;
}
export interface ChangeStaffRoleInput extends StaffRevisionInput {
  role: StaffRole;
  action: 'grant' | 'revoke';
  approval: string;
}
export interface StaffCapability {
  role: StaffRole;
  permission: string;
  context: PermissionContext;
  active: boolean;
  revision: number;
}
export interface StaffMatrix extends RecordPage<StaffCapability> {
  canEdit: boolean;
}
export interface ChangeCapabilityInput extends StaffRevisionInput {
  role: StaffRole;
  permission: string;
  context: PermissionContext;
  active: boolean;
  approval: string;
}
export interface CaseStaffAccess {
  candidate: { id: string; name: string } | null;
  permissions: string[];
  accesses: StaffAccess[];
}
export interface GrantStaffAccessInput {
  userId: string;
  permissions: string[];
  reason: string;
  approval: string;
  expiresAt?: string;
}
export interface StaffDeactivation {
  account: StaffAccount;
  providerBlocked: boolean | null;
}
