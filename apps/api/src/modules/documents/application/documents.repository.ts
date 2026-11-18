import type {
  DocumentUploadInput,
  DocumentUpload,
  UploadStatus,
  DocumentSummary,
  DocumentDetail,
  DocumentCategory,
  DocumentFilters,
  DocumentDestination,
  DocumentClassificationInput,
  DocumentAssociationInput,
  DocumentMetadataInput,
  DocumentVersionUploadInput,
  DocumentVersionHistoryEntry,
  DocumentOrganizationResult,
  RecordPage,
} from '@kvg/contracts';
export abstract class DocumentsRepository {
  abstract create(
    token: string,
    input: DocumentUploadInput,
  ): Promise<DocumentUpload>;
  abstract createVersion(
    token: string,
    id: string,
    input: DocumentVersionUploadInput,
  ): Promise<DocumentUpload>;
  abstract updateMetadata(
    token: string,
    id: string,
    input: DocumentMetadataInput,
  ): Promise<DocumentOrganizationResult>;
  abstract versions(
    token: string,
    id: string,
    query: { limit: number; offset: number },
  ): Promise<RecordPage<DocumentVersionHistoryEntry>>;
  abstract upload(token: string, id: string): Promise<UploadStatus>;
  abstract search(
    token: string,
    filters: DocumentFilters & { limit: number; offset: number },
  ): Promise<RecordPage<DocumentSummary>>;
  abstract destinations(
    token: string,
    id: string,
    query: { text?: string; limit: number; offset: number },
  ): Promise<RecordPage<DocumentDestination>>;
  abstract classify(
    token: string,
    id: string,
    input: DocumentClassificationInput,
  ): Promise<DocumentOrganizationResult>;
  abstract associate(
    token: string,
    id: string,
    input: DocumentAssociationInput,
  ): Promise<DocumentOrganizationResult>;
  abstract get(token: string, id: string): Promise<DocumentDetail>;
  abstract categories(token: string): Promise<DocumentCategory[]>;
  abstract authorizeDownload(
    token: string,
    versionId: string,
  ): Promise<{ id: string; sha256: string; size: number }>;
}
