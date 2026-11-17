export type UploadState =
  | 'RECIBIENDO'
  | 'PENDIENTE_VERIFICACION'
  | 'HABILITADO'
  | 'RECHAZADO'
  | 'ERROR_VERIFICACION'
  | 'ABANDONADO';
export interface DocumentUploadInput {
  requestId: string;
  caseId: string;
  name: string;
  categoryId: string;
  originalName: string;
  reason: string;
}
export interface DocumentUpload {
  id: string;
  documentId: string;
  state: UploadState;
}
export interface UploadStatus extends DocumentUpload {
  caseId: string;
  versionId: string | null;
  result: string | null;
}
export interface DocumentCategory {
  id: string;
  name: string;
}
export interface DocumentUploadAvailability {
  enabled: boolean;
}
export interface DocumentSummary {
  id: string;
  caseId: string;
  name: string;
  categoryId: string;
  versionId: string | null;
  number: number | null;
  status: string | null;
}
export interface DocumentDetail extends DocumentSummary {
  createdAt: string;
  authorId: string;
  authorName: string;
  categoryName: string;
  version: null | {
    id: string;
    number: number;
    sha256: string;
    size: number;
    format: string;
    status: string;
    publishedAt: string;
  };
}
