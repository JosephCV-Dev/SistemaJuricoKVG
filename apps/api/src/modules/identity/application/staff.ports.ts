import type {
  CaseStaffAccess,
  ChangeCapabilityInput,
  ChangeStaffRoleInput,
  GrantStaffAccessInput,
  RecordPage,
  ReserveInvitationInput,
  StaffAccount,
  StaffDetail,
  StaffMatrix,
  StaffRevisionInput,
  StaffRole,
} from '@kvg/contracts';

export abstract class StaffRepository {
  abstract list(
    token: string,
    query: { text?: string; limit: number; offset: number },
  ): Promise<RecordPage<StaffAccount>>;
  abstract detail(token: string, id: string): Promise<StaffDetail>;
  abstract reserve(
    token: string,
    input: ReserveInvitationInput,
  ): Promise<StaffAccount>;
  abstract invitationEmail(token: string, id: string): Promise<string>;
  abstract checkInvitation(accessToken: string): Promise<void>;
  abstract update(
    token: string,
    id: string,
    input: StaffRevisionInput & { name: string },
  ): Promise<StaffAccount>;
  abstract deactivate(
    token: string,
    id: string,
    input: StaffRevisionInput,
  ): Promise<{ account: StaffAccount; authId: string | null }>;
  abstract disabledAuthId(token: string, id: string): Promise<string | null>;
  abstract changeRole(
    token: string,
    id: string,
    input: ChangeStaffRoleInput,
  ): Promise<void>;
  abstract matrix(
    token: string,
    query: { role: StaffRole; limit: number; offset: number },
  ): Promise<StaffMatrix>;
  abstract changeCapability(
    token: string,
    input: ChangeCapabilityInput,
  ): Promise<void>;
  abstract caseAccesses(
    token: string,
    id: string,
    email?: string,
  ): Promise<CaseStaffAccess>;
  abstract grant(
    token: string,
    caseId: string,
    input: GrantStaffAccessInput,
  ): Promise<void>;
  abstract revoke(token: string, id: string, reason: string): Promise<void>;
}

export abstract class StaffAuth {
  abstract invite(email: string): Promise<void>;
  abstract verifyInvite(hash: string): Promise<string>;
  abstract setInvitedPassword(
    accessToken: string,
    password: string,
  ): Promise<void>;
  abstract block(authId: string): Promise<boolean>;
}
