import type {
  CaseStaffAccess,
  ChangeCapabilityInput,
  ChangeStaffRoleInput,
  GrantStaffAccessInput,
  RecordPage,
  ReserveInvitationInput,
  StaffAccount,
  StaffDeactivation,
  StaffDetail,
  StaffMatrix,
  StaffRevisionInput,
  StaffRole,
} from '@kvg/contracts';
import { getJson, mutate, readJson } from '../../shared/api/session-http';

const base = '/api/v1/staff';
const user = (id: string) => `/users/${encodeURIComponent(id)}`;
const casePath = (id: string) => `/cases/${encodeURIComponent(id)}/accesses`;

async function query<T>(path: string, signal: AbortSignal): Promise<T> {
  return (await getJson(base + path, signal)) as T;
}
async function change<T>(
  path: string,
  input: object,
  signal: AbortSignal,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<T> {
  const response = await mutate(base + path, input, signal, method);
  return (response.status === 204 ? undefined : await readJson(response)) as T;
}
export const listStaff = (text: string, offset: number, signal: AbortSignal) =>
  query<RecordPage<StaffAccount>>(
    '/users?' + new URLSearchParams({ text, offset: String(offset) }),
    signal,
  );
export const getStaff = (id: string, signal: AbortSignal) =>
  query<StaffDetail>(user(id), signal);
export const reserveStaffInvitation = (
  input: ReserveInvitationInput,
  signal: AbortSignal,
) => change<StaffAccount>('/users', input, signal);
export const sendStaffInvitation = (id: string, signal: AbortSignal) =>
  change<{ accepted: boolean }>(user(id) + '/invite', {}, signal);
export const editStaff = (
  id: string,
  input: StaffRevisionInput & { name: string },
  signal: AbortSignal,
) => change<StaffAccount>(user(id), input, signal, 'PATCH');
export const deactivateStaff = (
  id: string,
  input: StaffRevisionInput,
  signal: AbortSignal,
) => change<StaffDeactivation>(user(id) + '/deactivate', input, signal);
export const blockStaffAuth = (id: string, signal: AbortSignal) =>
  change<{ providerBlocked: boolean | null }>(
    user(id) + '/block-auth',
    {},
    signal,
  );
export const changeStaffRole = (
  id: string,
  input: ChangeStaffRoleInput,
  signal: AbortSignal,
) => change<void>(user(id) + '/roles', input, signal, 'PATCH');
export const staffMatrix = (
  role: StaffRole,
  offset: number,
  signal: AbortSignal,
) =>
  query<StaffMatrix>(
    '/matrix?' + new URLSearchParams({ role, offset: String(offset) }),
    signal,
  );
export const changeStaffCapability = (
  input: ChangeCapabilityInput,
  signal: AbortSignal,
) => change<void>('/matrix', input, signal, 'PATCH');
export const caseStaffAccess = (
  id: string,
  email: string,
  signal: AbortSignal,
) =>
  query<CaseStaffAccess>(
    casePath(id) + (email ? '?' + new URLSearchParams({ email }) : ''),
    signal,
  );
export const grantStaffAccess = (
  id: string,
  input: GrantStaffAccessInput,
  signal: AbortSignal,
) => change<void>(casePath(id), input, signal);
export const revokeStaffAccess = (
  id: string,
  reason: string,
  signal: AbortSignal,
) =>
  change<void>(
    `/accesses/${encodeURIComponent(id)}/revoke`,
    { reason },
    signal,
  );
