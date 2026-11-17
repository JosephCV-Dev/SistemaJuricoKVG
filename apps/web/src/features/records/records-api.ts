import type {
  CaseDetail,
  CaseInput,
  CaseUpdateInput,
  CaseSummary,
  ClientDetail,
  ClientInput,
  ClientUpdateInput,
  ClientSummary,
  IdentificationType,
  RecordPage,
  SessionCapabilities,
} from '@kvg/contracts';
import { getJson, mutate, readJson } from '../../shared/api/session-http.ts';

function invalid(): never {
  throw new Error(
    'La respuesta de clientes o expedientes tiene un formato inesperado.',
  );
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length) return invalid();
  return value;
}
function nullable(value: unknown): string | null {
  return value === null ? null : text(value);
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    return invalid();
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid();
  return value;
}
function array<T>(value: unknown, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalid();
  return value.map(read);
}
function date(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) return invalid();
  return result;
}
export function readClient(value: unknown): ClientSummary {
  const row = record(value);
  return {
    id: text(row.id),
    name: text(row.name),
    type: text(row.type),
    createdAt: date(row.createdAt),
    revision: number(row.revision),
  };
}
export function readCase(value: unknown): CaseSummary {
  const row = record(value);
  if (
    !['NUEVO', 'EN_PROCESO', 'PENDIENTE', 'CONCLUIDO', 'ARCHIVADO'].includes(
      String(row.status),
    )
  )
    return invalid();
  return {
    id: text(row.id),
    folio: text(row.folio),
    clientId: text(row.clientId),
    description: text(row.description),
    status: row.status as CaseSummary['status'],
    externalNumber: nullable(row.externalNumber),
    externalAuthority: nullable(row.externalAuthority),
    createdAt: date(row.createdAt),
    revision: number(row.revision),
  };
}
function page<T>(value: unknown, read: (item: unknown) => T): RecordPage<T> {
  const row = record(value);
  const result = {
    items: array(row.items, read),
    offset: number(row.offset),
    limit: number(row.limit),
    hasMore: bool(row.hasMore),
  };
  if (
    result.limit < 1 ||
    result.limit > 50 ||
    result.items.length > result.limit
  )
    return invalid();
  return result;
}
export async function getCapabilities(
  signal: AbortSignal,
): Promise<SessionCapabilities> {
  const row = record(await getJson('/api/v1/auth/capabilities', signal));
  return {
    capabilities: array(row.capabilities, (value) => {
      const item = record(value);
      return { permission: text(item.permission), context: text(item.context) };
    }),
  };
}
export async function getIdentificationTypes(
  signal: AbortSignal,
  clientId?: string,
): Promise<IdentificationType[]> {
  const path = clientId
    ? `/api/v1/clients/${encodeURIComponent(clientId)}/edit-identification-types`
    : '/api/v1/clients/identification-types';
  return array(await getJson(path, signal), (value) => {
    const item = record(value);
    return {
      code: text(item.code),
      name: text(item.name),
      unique: bool(item.unique),
    };
  });
}
export async function searchClients(
  search: string,
  offset: number,
  signal: AbortSignal,
  identification = '',
): Promise<RecordPage<ClientSummary>> {
  const query = new URLSearchParams({
    text: search,
    offset: String(offset),
    limit: '20',
  });
  if (identification) query.set('identification', identification);
  return page(await getJson(`/api/v1/clients?${query}`, signal), readClient);
}
export async function searchCases(
  filters: {
    text: string;
    status: string;
    client?: string;
    responsible?: string;
  },
  offset: number,
  signal: AbortSignal,
): Promise<RecordPage<CaseSummary>> {
  const query = new URLSearchParams({
    text: filters.text,
    offset: String(offset),
    limit: '20',
  });
  if (filters.status) query.set('status', filters.status);
  if (filters.client) query.set('client', filters.client);
  if (filters.responsible) query.set('responsible', filters.responsible);
  return page(await getJson(`/api/v1/cases?${query}`, signal), readCase);
}
export async function getClient(
  id: string,
  signal: AbortSignal,
): Promise<ClientDetail> {
  const row = record(
    await getJson(`/api/v1/clients/${encodeURIComponent(id)}`, signal),
  );
  return {
    ...readClient(row),
    canEdit: bool(row.canEdit),
    identifications: array(row.identifications, (value) => {
      const item = record(value);
      return { type: text(item.type), value: text(item.value) };
    }),
    contacts: array(row.contacts, (value) => {
      const item = record(value);
      if (!['CORREO', 'TELEFONO'].includes(String(item.type))) return invalid();
      return {
        type: item.type as 'CORREO' | 'TELEFONO',
        value: text(item.value),
        preferred: bool(item.preferred),
        ...(item.label === undefined ? {} : { label: text(item.label) }),
      };
    }),
  };
}
export async function getCase(
  id: string,
  signal: AbortSignal,
): Promise<CaseDetail> {
  const row = record(
    await getJson(`/api/v1/cases/${encodeURIComponent(id)}`, signal),
  );
  return {
    ...readCase(row),
    canEdit: bool(row.canEdit),
    clientName: nullable(row.clientName),
    assignments: array(row.assignments, (value) => {
      const item = record(value);
      return {
        userId: text(item.userId),
        name: text(item.name),
        function: text(item.function),
        active: bool(item.active),
      };
    }),
    history: array(row.history, (value) => {
      const item = record(value);
      return {
        from: nullable(item.from),
        to: text(item.to),
        reason: text(item.reason),
        at: date(item.at),
      };
    }),
    progress: array(row.progress, (value) => {
      const item = record(value);
      return { description: text(item.description), at: date(item.at) };
    }),
  };
}
export async function createClient(input: ClientInput, signal: AbortSignal) {
  return readClient(
    await readJson(await mutate('/api/v1/clients', input, signal)),
  );
}
export async function updateClient(
  id: string,
  input: ClientUpdateInput,
  signal: AbortSignal,
) {
  return readClient(
    await readJson(
      await mutate(
        `/api/v1/clients/${encodeURIComponent(id)}`,
        input,
        signal,
        'PATCH',
      ),
    ),
  );
}
export async function createCase(input: CaseInput, signal: AbortSignal) {
  return readCase(await readJson(await mutate('/api/v1/cases', input, signal)));
}

export async function updateCase(
  id: string,
  input: CaseUpdateInput,
  signal: AbortSignal,
) {
  return readCase(
    await readJson(
      await mutate(
        `/api/v1/cases/${encodeURIComponent(id)}`,
        input,
        signal,
        'PATCH',
      ),
    ),
  );
}
