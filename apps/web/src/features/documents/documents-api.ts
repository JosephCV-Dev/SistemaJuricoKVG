import type {
  DocumentCategory,
  DocumentFilters,
  DocumentDestination,
  DocumentClassificationInput,
  DocumentAssociationInput,
  DocumentOrganizationResult,
  DocumentLegalReview,
  DocumentReviewInput,
  DocumentReviewResult,
  DocumentReviewOutcome,
  DocumentState,
  DocumentStateChange,
  DocumentStateInput,
  DocumentStateResult,
  DocumentVersionReview,
  RetireDocumentInput,
  RetireDocumentResult,
  RecoverDocumentInput,
  DocumentRecoveryState,
  DocumentRecoveryStatus,
  RetiredDocument,
  DocumentDetail,
  DocumentMetadataInput,
  DocumentVersion,
  DocumentVersionHistoryEntry,
  DocumentVersionUploadInput,
  DocumentSummary,
  DocumentUploadInput,
  DocumentUploadAvailability,
  RecordPage,
  UploadStatus,
  UploadState,
} from '@kvg/contracts';
import { getJson, mutate, readJson } from '../../shared/api/session-http.ts';
import {
  documentReviewLabels,
  documentStateLabels,
} from './document-format.ts';
const invalid = (): never => {
  throw new Error('La respuesta documental no cumple el contrato.');
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : invalid();
const text = (v: unknown): string =>
  typeof v === 'string' && v.length > 0 ? v : invalid();
const nullable = (v: unknown) => (v === null ? null : text(v));
const integer = (v: unknown): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid();
function summary(v: unknown): DocumentSummary {
  const r = obj(v);
  return {
    id: text(r.id),
    caseId: text(r.caseId),
    name: text(r.name),
    categoryId: text(r.categoryId),
    ...(r.categoryName === undefined
      ? {}
      : { categoryName: text(r.categoryName) }),
    ...(r.caseFolio === undefined ? {} : { caseFolio: nullable(r.caseFolio) }),
    ...(r.createdAt === undefined ? {} : { createdAt: text(r.createdAt) }),
    versionId: nullable(r.versionId),
    number: r.number === null ? null : integer(r.number),
    status: nullable(r.status),
  };
}
function upload(v: unknown) {
  const r = obj(v);
  const state = text(r.state);
  if (
    ![
      'RECIBIENDO',
      'PENDIENTE_VERIFICACION',
      'HABILITADO',
      'RECHAZADO',
      'ERROR_VERIFICACION',
      'ABANDONADO',
    ].includes(state)
  )
    return invalid();
  return {
    id: text(r.id),
    documentId: text(r.documentId),
    state: state as UploadState,
  };
}
const base = '/api/v1/documents';
export async function uploadAvailability(
  signal: AbortSignal,
): Promise<DocumentUploadAvailability> {
  const result = obj(await getJson(base + '/upload-availability', signal));
  if (typeof result.enabled !== 'boolean') return invalid();
  return {
    enabled: result.enabled,
    ...(result.beta === true ? { beta: true } : {}),
  };
}
export async function categories(
  signal: AbortSignal,
  forSearch = false,
): Promise<DocumentCategory[]> {
  const value = await getJson(
    base + (forSearch ? '/search-categories' : '/categories'),
    signal,
  );
  return array(value, (item) => {
    const r = obj(item);
    return { id: text(r.id), name: text(r.name) };
  });
}
function array<T>(value: unknown, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalid();
  return value.map(read);
}
function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}
function documentState(value: unknown): DocumentState {
  const state = text(value);
  return Object.hasOwn(documentStateLabels, state)
    ? (state as DocumentState)
    : invalid();
}
function reviewOutcome(value: unknown): DocumentReviewOutcome {
  const result = text(value);
  return Object.hasOwn(documentReviewLabels, result)
    ? (result as DocumentReviewOutcome)
    : invalid();
}
function stateResult(row: Record<string, unknown>): DocumentStateResult {
  return {
    versionId: text(row.versionId),
    status: documentState(row.status),
    revision: integer(row.revision),
  };
}
function reviewEvent(
  value: unknown,
): DocumentLegalReview | DocumentStateChange {
  const row = obj(value);
  const shared = {
    id: text(row.id),
    author: text(row.author),
    at: text(row.at),
  };
  if (row.kind === 'review')
    return {
      ...shared,
      kind: 'review',
      result: reviewOutcome(row.result),
      observations: text(row.observations),
      correctsId: nullable(row.correctsId),
      superseded: bool(row.superseded),
    };
  if (row.kind === 'state')
    return {
      ...shared,
      kind: 'state',
      previous: row.previous === null ? null : documentState(row.previous),
      status: documentState(row.status),
      reason: text(row.reason),
      reviewId: nullable(row.reviewId),
    };
  return invalid();
}
function page<T>(value: unknown, read: (item: unknown) => T): RecordPage<T> {
  const r = obj(value);
  const limit = integer(r.limit);
  const items = array(r.items, read);
  if (limit < 1 || limit > 50 || items.length > limit) return invalid();
  return { items, limit, offset: integer(r.offset), hasMore: bool(r.hasMore) };
}
function version(r: Record<string, unknown>): DocumentVersion {
  return {
    id: text(r.id),
    number: integer(r.number),
    size: integer(r.size),
    format: text(r.format),
    status: text(r.status),
    publishedAt: text(r.publishedAt),
    ...(r.beta === true ? { beta: true } : {}),
  };
}
export async function listDocuments(
  caseId: string,
  offset: number,
  signal: AbortSignal,
) {
  return searchDocuments({ caseId }, offset, signal);
}
export async function searchDocuments(
  filters: DocumentFilters,
  offset: number,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ offset: String(offset) });
  for (const [key, value] of Object.entries(filters))
    if (value) query.set(key, value);
  return page(await getJson(`${base}?${query}`, signal), summary);
}
export async function getDocument(
  id: string,
  signal: AbortSignal,
): Promise<DocumentDetail> {
  const r = obj(await getJson(`${base}/${encodeURIComponent(id)}`, signal));
  const v = r.version === null ? null : obj(r.version);
  return {
    ...summary(r),
    revision: integer(r.revision),
    canClassify: bool(r.canClassify),
    canAssociate: bool(r.canAssociate),
    canEditName: bool(r.canEditName),
    canUploadVersion: bool(r.canUploadVersion),
    canViewVersions: bool(r.canViewVersions),
    canRetire: bool(r.canRetire),
    fileAvailable: bool(r.fileAvailable),
    classifications: array(r.classifications, (item) => {
      const row = obj(item);
      return {
        id: text(row.id),
        previous: text(row.previous),
        category: text(row.category),
        reason: nullable(row.reason),
        author: text(row.author),
        at: text(row.at),
      };
    }),
    associations: array(r.associations, (item) => {
      const row = obj(item);
      return {
        id: text(row.id),
        hasSource: bool(row.hasSource),
        sourceFolio: nullable(row.sourceFolio),
        destinationFolio: nullable(row.destinationFolio),
        reason: nullable(row.reason),
        author: text(row.author),
        at: text(row.at),
      };
    }),
    createdAt: text(r.createdAt),
    authorName: text(r.authorName),
    categoryName: text(r.categoryName),
    version: v ? version(v) : null,
  };
}
export async function createUpload(
  input: DocumentUploadInput,
  signal: AbortSignal,
) {
  return upload(await readJson(await mutate(base + '/uploads', input, signal)));
}
export async function createVersionUpload(
  id: string,
  input: DocumentVersionUploadInput,
  signal: AbortSignal,
) {
  const path = `${base}/${encodeURIComponent(id)}/versions`;
  return upload(await readJson(await mutate(path, input, signal)));
}
export async function documentVersions(
  id: string,
  offset: number,
  signal: AbortSignal,
): Promise<RecordPage<DocumentVersionHistoryEntry>> {
  const query = new URLSearchParams({ offset: String(offset) });
  return page(
    await getJson(
      `${base}/${encodeURIComponent(id)}/versions?${query}`,
      signal,
    ),
    (value) => {
      const row = obj(value);
      return {
        ...version(row),
        ...(row.integrityHash !== undefined
          ? { integrityHash: text(row.integrityHash) }
          : {}),
        author: text(row.author),
        reason: text(row.reason),
        current: bool(row.current),
        canDownload: bool(row.canDownload),
        reviews: array(row.reviews, (value) => {
          const review = obj(value);
          return {
            id: text(review.id),
            author: text(review.author),
            result: text(review.result),
            at: text(review.at),
          };
        }),
      };
    },
  );
}
function versionResource(id: string, versionId: string) {
  return `${base}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`;
}
export async function documentVersionReview(
  id: string,
  versionId: string,
  offset: number,
  signal: AbortSignal,
): Promise<DocumentVersionReview> {
  const query = new URLSearchParams({ offset: String(offset) });
  const row = obj(
    await getJson(`${versionResource(id, versionId)}/review?${query}`, signal),
  );
  return {
    ...stateResult(row),
    number: integer(row.number),
    current: bool(row.current),
    canReview: bool(row.canReview),
    transitions: array(row.transitions, (value) => {
      const transition = obj(value);
      return {
        status: documentState(transition.status),
        requiresReview: bool(transition.requiresReview),
      };
    }),
    timeline: page(row.timeline, reviewEvent),
  };
}
export async function saveDocumentReview(
  id: string,
  versionId: string,
  input: DocumentReviewInput,
  signal: AbortSignal,
): Promise<DocumentReviewResult> {
  const row = obj(
    await readJson(
      await mutate(`${versionResource(id, versionId)}/review`, input, signal),
    ),
  );
  return {
    id: text(row.id),
    currentVersionChanged: bool(row.currentVersionChanged),
  };
}
export async function changeDocumentState(
  id: string,
  versionId: string,
  input: DocumentStateInput,
  signal: AbortSignal,
): Promise<DocumentStateResult> {
  return stateResult(
    obj(
      await readJson(
        await mutate(
          `${versionResource(id, versionId)}/state`,
          input,
          signal,
          'PATCH',
        ),
      ),
    ),
  );
}
export async function uploadStatus(
  id: string,
  signal: AbortSignal,
): Promise<UploadStatus> {
  const r = obj(
    await getJson(`${base}/uploads/${encodeURIComponent(id)}`, signal),
  );
  return {
    ...upload(r),
    caseId: text(r.caseId),
    versionId: nullable(r.versionId),
    result: nullable(r.result),
  };
}
export async function transfer(
  id: string,
  file: File,
  signal: AbortSignal,
): Promise<UploadStatus> {
  const csrf = obj(await getJson('/api/v1/auth/csrf', signal));
  const r = await fetch(`${base}/uploads/${encodeURIComponent(id)}/content`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-CSRF-Token': text(csrf.csrfToken),
    },
    body: file,
    signal,
  });
  const data = obj(await readJson(r));
  return {
    ...upload(data),
    caseId: text(data.caseId),
    versionId: nullable(data.versionId),
    result: nullable(data.result),
  };
}
export async function downloadVersion(id: string, signal: AbortSignal) {
  const response = await fetch(
    `${base}/versions/${encodeURIComponent(id)}/download`,
    { credentials: 'same-origin', cache: 'no-store', signal },
  );
  if (!response.ok) await readJson(response);
  const blob = await response.blob();
  if (blob.size > 20_000_000) return invalid();
  return blob;
}

export async function documentDestinations(
  id: string,
  folio: string,
  offset: number,
  signal: AbortSignal,
): Promise<RecordPage<DocumentDestination>> {
  const query = new URLSearchParams({ text: folio, offset: String(offset) });
  return page(
    await getJson(
      `${base}/${encodeURIComponent(id)}/destinations?${query}`,
      signal,
    ),
    (value) => {
      const row = obj(value);
      return { id: text(row.id), folio: text(row.folio) };
    },
  );
}
export async function organizeDocument(
  id: string,
  input: DocumentClassificationInput | DocumentAssociationInput,
  signal: AbortSignal,
): Promise<DocumentOrganizationResult> {
  const path = 'destinationId' in input ? 'association' : 'category';
  return changeDocument(id, path, input, signal);
}
export async function updateDocumentMetadata(
  id: string,
  input: DocumentMetadataInput,
  signal: AbortSignal,
): Promise<DocumentOrganizationResult> {
  return changeDocument(id, 'metadata', input, signal);
}
async function changeDocument(
  id: string,
  path: 'association' | 'category' | 'metadata',
  input:
    | DocumentClassificationInput
    | DocumentAssociationInput
    | DocumentMetadataInput,
  signal: AbortSignal,
): Promise<DocumentOrganizationResult> {
  const row = obj(
    await readJson(
      await mutate(
        `${base}/${encodeURIComponent(id)}/${path}`,
        input,
        signal,
        'PATCH',
      ),
    ),
  );
  return {
    id: text(row.id),
    caseId: text(row.caseId),
    revision: integer(row.revision),
  };
}
export async function saveDocumentDownload(
  name: string,
  version: DocumentVersion,
  signal: AbortSignal,
) {
  const blob = await downloadVersion(version.id, signal);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-v${version.number}.${version.format.toLowerCase()}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function recoveryState(value: unknown): DocumentRecoveryState {
  switch (value) {
    case 'EN_COLA':
    case 'EN_EJECUCION':
    case 'COMPLETADO':
    case 'FALLIDO':
    case 'CANCELADO':
      return value;
    default:
      return invalid();
  }
}
function recoveryStatus(value: unknown): DocumentRecoveryStatus {
  const row = obj(value);
  const mode = row.mode;
  if (mode !== null && mode !== 'BETA' && mode !== 'VERIFICADO')
    return invalid();
  return {
    id: text(row.id),
    documentId: text(row.documentId),
    state: recoveryState(row.state),
    result: nullable(row.result),
    mode,
  };
}
export async function retireDocument(
  id: string,
  input: RetireDocumentInput,
  signal: AbortSignal,
): Promise<RetireDocumentResult> {
  const row = obj(
    await readJson(
      await mutate(`${base}/${encodeURIComponent(id)}/retire`, input, signal),
    ),
  );
  return { id: text(row.id), revision: integer(row.revision) };
}
export async function retiredDocuments(
  filter: string,
  offset: number,
  signal: AbortSignal,
): Promise<RecordPage<RetiredDocument>> {
  const query = new URLSearchParams({ text: filter, offset: String(offset) });
  return page(await getJson(`${base}/retired?${query}`, signal), (value) => {
    const row = obj(value);
    return {
      id: text(row.id),
      caseFolio: nullable(row.caseFolio),
      retiredAt: text(row.retiredAt),
      revision: integer(row.revision),
      canRecover: bool(row.canRecover),
      jobId: nullable(row.jobId),
      jobState: row.jobState === null ? null : recoveryState(row.jobState),
    };
  });
}
export async function recoverDocument(
  id: string,
  input: RecoverDocumentInput,
  signal: AbortSignal,
) {
  return recoveryStatus(
    await readJson(
      await mutate(`${base}/${encodeURIComponent(id)}/recover`, input, signal),
    ),
  );
}
export async function documentRecoveryStatus(id: string, signal: AbortSignal) {
  return recoveryStatus(
    await getJson(`${base}/recoveries/${encodeURIComponent(id)}`, signal),
  );
}
