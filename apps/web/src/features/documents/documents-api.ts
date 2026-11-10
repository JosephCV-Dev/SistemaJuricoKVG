import type {
  DocumentCategory,
  DocumentDetail,
  DocumentSummary,
  DocumentUploadInput,
  RecordPage,
  UploadStatus,
  UploadState,
} from '@kvg/contracts';
import { getJson, mutate, readJson } from '../../shared/api/session-http.ts';
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
export async function categories(
  signal: AbortSignal,
): Promise<DocumentCategory[]> {
  const v = await getJson(base + '/categories', signal);
  if (!Array.isArray(v)) return invalid();
  return v.map((value) => {
    const r = obj(value);
    return { id: text(r.id), name: text(r.name) };
  });
}
export async function listDocuments(
  caseId: string,
  offset: number,
  signal: AbortSignal,
): Promise<RecordPage<DocumentSummary>> {
  const r = obj(
    await getJson(
      `${base}?${new URLSearchParams({ caseId, offset: String(offset) })}`,
      signal,
    ),
  );
  if (!Array.isArray(r.items) || typeof r.hasMore !== 'boolean')
    return invalid();
  return {
    items: r.items.map(summary),
    limit: integer(r.limit),
    offset: integer(r.offset),
    hasMore: r.hasMore,
  };
}
export async function getDocument(
  id: string,
  signal: AbortSignal,
): Promise<DocumentDetail> {
  const r = obj(await getJson(`${base}/${encodeURIComponent(id)}`, signal));
  const v = r.version === null ? null : obj(r.version);
  return {
    ...summary(r),
    createdAt: text(r.createdAt),
    authorId: text(r.authorId),
    authorName: text(r.authorName),
    categoryName: text(r.categoryName),
    version: v
      ? {
          id: text(v.id),
          number: integer(v.number),
          size: integer(v.size),
          sha256: text(v.sha256),
          format: text(v.format),
          status: text(v.status),
          publishedAt: text(v.publishedAt),
        }
      : null,
  };
}
export async function createUpload(
  input: DocumentUploadInput,
  signal: AbortSignal,
) {
  return upload(await readJson(await mutate(base + '/uploads', input, signal)));
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
