import type { RecordPage } from './records';

export type UploadState =
  | 'RECIBIENDO'
  | 'PENDIENTE_VERIFICACION'
  | 'HABILITADO'
  | 'RECHAZADO'
  | 'ERROR_VERIFICACION'
  | 'ABANDONADO';
export interface DocumentFileInput {
  requestId: string;
  originalName: string;
  reason: string;
}
export interface DocumentUploadInput extends DocumentFileInput {
  caseId: string;
  name: string;
  categoryId: string;
}
export interface DocumentVersionUploadInput extends DocumentFileInput {
  revision: number;
}
export interface DocumentMetadataInput {
  revision: number;
  name: string;
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
  beta?: true;
}
export interface DocumentSummary {
  id: string;
  caseId: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  caseFolio?: string | null;
  createdAt?: string;
  versionId: string | null;
  number: number | null;
  status: string | null;
}
export interface DocumentDetail extends DocumentSummary {
  createdAt: string;
  revision: number;
  canClassify: boolean;
  canAssociate: boolean;
  canEditName: boolean;
  canUploadVersion: boolean;
  canViewVersions: boolean;
  canRetire: boolean;
  fileAvailable: boolean;
  classifications: DocumentClassification[];
  associations: DocumentAssociation[];
  authorName: string;
  categoryName: string;
  version: DocumentVersion | null;
}
export interface RetireDocumentInput {
  revision: number;
  reason: string;
}
export interface RetireDocumentResult {
  id: string;
  revision: number;
}
export interface RecoverDocumentInput extends RetireDocumentInput {
  requestId: string;
}
export type DocumentRecoveryState =
  'EN_COLA' | 'EN_EJECUCION' | 'COMPLETADO' | 'FALLIDO' | 'CANCELADO';
export interface DocumentRecoveryStatus {
  id: string;
  documentId: string;
  state: DocumentRecoveryState;
  result: string | null;
  mode: 'BETA' | 'VERIFICADO' | null;
}
export interface RetiredDocument {
  id: string;
  caseFolio: string | null;
  retiredAt: string;
  revision: number;
  canRecover: boolean;
  jobId: string | null;
  jobState: DocumentRecoveryState | null;
}
export interface DocumentVersion {
  id: string;
  number: number;
  size: number;
  format: string;
  status: string;
  publishedAt: string;
  beta?: true;
}
export interface DocumentVersionHistoryEntry extends DocumentVersion {
  integrityHash?: string;
  author: string;
  reason: string;
  current: boolean;
  canDownload: boolean;
  reviews: {
    id: string;
    author: string;
    result: string;
    at: string;
  }[];
}

export type DocumentState =
  'RECIBIDO' | 'EN_REVISION' | 'VALIDADO' | 'ARCHIVADO';
export type DocumentReviewOutcome =
  'OBSERVACIONES' | 'APTO_PARA_VALIDAR' | 'REQUIERE_CORRECCION';
export interface DocumentReviewInput {
  requestId: string;
  result: DocumentReviewOutcome;
  observations: string;
  correctsId?: string;
}
export interface DocumentReviewResult {
  id: string;
  currentVersionChanged: boolean;
}
export interface DocumentStateInput {
  revision: number;
  status: DocumentState;
  reason: string;
  reviewId?: string;
}
export interface DocumentStateResult {
  versionId: string;
  status: DocumentState;
  revision: number;
}
interface DocumentTimelineEntry {
  id: string;
  author: string;
  at: string;
}
export interface DocumentLegalReview extends DocumentTimelineEntry {
  kind: 'review';
  result: DocumentReviewOutcome;
  observations: string;
  correctsId: string | null;
  superseded: boolean;
}
export interface DocumentStateChange extends DocumentTimelineEntry {
  kind: 'state';
  previous: DocumentState | null;
  status: DocumentState;
  reason: string;
  reviewId: string | null;
}
export interface DocumentVersionReview extends DocumentStateResult {
  number: number;
  current: boolean;
  canReview: boolean;
  transitions: { status: DocumentState; requiresReview: boolean }[];
  timeline: RecordPage<DocumentLegalReview | DocumentStateChange>;
}

export type ClassificationReason =
  'CORREGIR_CLASIFICACION' | 'ORGANIZACION_CATALOGO' | 'OTRA_CORRECCION';
export interface DocumentClassification {
  id: string;
  previous: string;
  category: string;
  reason: string | null;
  author: string;
  at: string;
}
export interface DocumentAssociation {
  id: string;
  hasSource: boolean;
  sourceFolio: string | null;
  destinationFolio: string | null;
  reason: string | null;
  author: string;
  at: string;
}
export interface DocumentFilters {
  caseId?: string;
  categoryId?: string;
  text?: string;
  folio?: string;
  client?: string;
  from?: string;
  to?: string;
  status?: DocumentState;
  order?: 'recientes' | 'antiguos' | 'nombre';
}
export interface DocumentDestination {
  id: string;
  folio: string;
}
export interface DocumentClassificationInput {
  revision: number;
  categoryId: string;
  reason?: ClassificationReason;
}
export interface DocumentAssociationInput {
  revision: number;
  destinationId: string;
  reason: string;
}
export interface DocumentOrganizationResult {
  id: string;
  caseId: string;
  revision: number;
}
