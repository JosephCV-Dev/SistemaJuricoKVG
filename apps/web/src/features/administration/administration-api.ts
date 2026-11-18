import type {
  AuditEventDetail,
  AuditPage,
  ConfigurationSnapshot,
} from '@kvg/contracts';
import { getJson, mutate } from '../../shared/api/session-http';

export const listAudit = async (
  filters: URLSearchParams,
  signal: AbortSignal,
) => (await getJson('/api/v1/audit?' + filters, signal)) as AuditPage;

export const auditDetail = async (id: string, signal: AbortSignal) =>
  (await getJson(
    '/api/v1/audit/' + encodeURIComponent(id),
    signal,
  )) as AuditEventDetail;

export const configurationSnapshot = async (signal: AbortSignal) =>
  (await getJson('/api/v1/configuration', signal)) as ConfigurationSnapshot;

export async function saveConfiguration(
  path: string,
  method: 'POST' | 'PATCH',
  input: object,
  signal: AbortSignal,
): Promise<void> {
  await mutate('/api/v1/configuration' + path, input, signal, method);
}
