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
  AssignedCase,
  CaseAssignmentInput,
  CaseAssignmentRole,
  CaseAssignmentSummary,
  CaseParticipation,
  CaseReassignmentInput,
  CaseTeam,
  CaseStateChangeInput,
  CaseProgressInput,
  CaseProgressReference,
  CaseStatus,
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
    canAssign: bool(row.canAssign),
    hasActivePrincipal: bool(row.hasActivePrincipal),
    canAddProgress: bool(row.canAddProgress),
    transitions: array(row.transitions, (value) => {
      const item = record(value);
      return {
        status: readStatus(item.status),
        requiresDecision: bool(item.requiresDecision),
      };
    }),
    canEdit: bool(row.canEdit),
    clientName: nullable(row.clientName),
    assignments: array(row.assignments, (value) => {
      const item = record(value);
      return {
        userId: text(item.userId),
        name: text(item.name),
        function: text(item.function),
        active: bool(item.active),
        startsAt: date(item.startsAt),
        endsAt: item.endsAt === null ? null : date(item.endsAt),
      };
    }),
    history: array(row.history, (value) => {
      const item = record(value);
      return {
        from: nullable(item.from),
        to: text(item.to),
        reason: text(item.reason),
        at: date(item.at),
        authorName: nullable(item.authorName),
        approvalReference: nullable(item.approvalReference),
      };
    }),
    progress: array(row.progress, (value) => {
      const item = record(value);
      return {
        id: text(item.id),
        description: text(item.description),
        at: date(item.at),
        authorName: nullable(item.authorName),
        correctsId: nullable(item.correctsId),
        occurredOn: nullable(item.occurredOn),
        source: nullable(item.source),
        references: array(item.references, readProgressReference),
      };
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

function readRole(value: unknown): CaseAssignmentRole {
  if (value === 'PRINCIPAL' || value === 'COLABORADOR') return value;
  return invalid();
}
function readAssignmentSummary(value: unknown): CaseAssignmentSummary {
  const row = record(value);
  const status = row.status;
  if (
    status !== 'NUEVO' &&
    status !== 'EN_PROCESO' &&
    status !== 'PENDIENTE' &&
    status !== 'CONCLUIDO' &&
    status !== 'ARCHIVADO'
  )
    return invalid();
  return { id: text(row.id), folio: text(row.folio), status };
}
function paging(textValue: string, offset: number) {
  return new URLSearchParams({
    text: textValue,
    offset: String(offset),
    limit: '20',
  });
}
export interface AssignedFilters {
  text: string;
  status: string;
  participation: string;
  from: string;
  to: string;
}
export async function searchAssigned(
  filters: AssignedFilters,
  offset: number,
  signal: AbortSignal,
): Promise<RecordPage<AssignedCase>> {
  const query = paging(filters.text, offset);
  for (const key of ['status', 'participation', 'from', 'to'] as const)
    if (filters[key]) query.set(key, filters[key]);
  return page(
    await getJson(`/api/v1/cases/assigned?${query}`, signal),
    (value) => {
      const row = record(value);
      return {
        ...readCase(row),
        participation: array(row.participation, (item): CaseParticipation =>
          item === 'EXPLICITO' ? item : readRole(item),
        ),
      };
    },
  );
}
export async function searchReassignable(
  folio: string,
  offset: number,
  signal: AbortSignal,
) {
  return page(
    await getJson(
      `/api/v1/cases/reassignable?${paging(folio, offset)}`,
      signal,
    ),
    readAssignmentSummary,
  );
}
export async function getCaseTeam(
  id: string,
  reassign: boolean,
  search: string,
  offset: number,
  signal: AbortSignal,
): Promise<CaseTeam> {
  const path = reassign ? 'reassignment-team' : 'assignment-team';
  const row = record(
    await getJson(
      `/api/v1/cases/${encodeURIComponent(id)}/${path}?${paging(search, offset)}`,
      signal,
    ),
  );
  return {
    ...readAssignmentSummary(row),
    revision: number(row.revision),
    assignments: array(row.assignments, (value) => {
      const item = record(value);
      return {
        id: text(item.id),
        userId: text(item.userId),
        name: text(item.name),
        role: readRole(item.role),
        startsAt: date(item.startsAt),
        endsAt: item.endsAt === null ? null : date(item.endsAt),
      };
    }),
    lawyers: page(row.lawyers, (value) => {
      const item = record(value);
      return { id: text(item.id), name: text(item.name) };
    }),
  };
}
export async function saveCaseAssignment(
  id: string,
  input: CaseAssignmentInput | CaseReassignmentInput,
  signal: AbortSignal,
) {
  const path = 'approvalReference' in input ? 'reassignments' : 'assignments';
  const result = record(
    await readJson(
      await mutate(
        `/api/v1/cases/${encodeURIComponent(id)}/${path}`,
        input,
        signal,
      ),
    ),
  );
  return {
    assignmentId: text(result.assignmentId),
    caseId: text(result.caseId),
    revision: number(result.revision),
  };
}

function readStatus(value: unknown): CaseStatus {
  switch (value) {
    case 'NUEVO':
    case 'EN_PROCESO':
    case 'PENDIENTE':
    case 'CONCLUIDO':
    case 'ARCHIVADO':
      return value;
    default:
      return invalid();
  }
}
function readProgressReference(value: unknown): CaseProgressReference {
  const row = record(value);
  return {
    versionId: text(row.versionId),
    documentId: text(row.documentId),
    name: text(row.name),
    number: number(row.number),
  };
}
export async function changeCaseState(
  id: string,
  input: CaseStateChangeInput,
  signal: AbortSignal,
) {
  const row = record(
    await readJson(
      await mutate(
        `/api/v1/cases/${encodeURIComponent(id)}/status`,
        input,
        signal,
        'PATCH',
      ),
    ),
  );
  return {
    caseId: text(row.caseId),
    status: readStatus(row.status),
    revision: number(row.revision),
  };
}
export async function addCaseProgress(
  id: string,
  input: CaseProgressInput,
  signal: AbortSignal,
) {
  const row = record(
    await readJson(
      await mutate(
        `/api/v1/cases/${encodeURIComponent(id)}/progress`,
        input,
        signal,
      ),
    ),
  );
  return { id: text(row.id) };
}
export async function getProgressReferences(
  id: string,
  search: string,
  offset: number,
  signal: AbortSignal,
) {
  return page(
    await getJson(
      `/api/v1/cases/${encodeURIComponent(id)}/progress-references?${paging(search, offset)}`,
      signal,
    ),
    readProgressReference,
  );
}
