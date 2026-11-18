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
  fileAvailable: boolean;
  classifications: DocumentClassification[];
  associations: DocumentAssociation[];
  authorId: string;
  authorName: string;
  categoryName: string;
  version: DocumentVersion | null;
}
export interface DocumentVersion {
  id: string;
  number: number;
  sha256: string;
  size: number;
  format: string;
  status: string;
  publishedAt: string;
  beta?: true;
}
export interface DocumentVersionHistoryEntry extends DocumentVersion {
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
  status?: 'RECIBIDO' | 'EN_REVISION' | 'VALIDADO' | 'ARCHIVADO';
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
