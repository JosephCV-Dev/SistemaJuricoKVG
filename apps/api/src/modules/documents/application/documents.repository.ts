import type {
  DocumentUploadInput,
  DocumentUpload,
  UploadStatus,
  DocumentSummary,
  DocumentDetail,
  DocumentCategory,
  RecordPage,
} from '@kvg/contracts';
export abstract class DocumentsRepository {
  abstract create(
    token: string,
    input: DocumentUploadInput,
  ): Promise<DocumentUpload>;
  abstract upload(token: string, id: string): Promise<UploadStatus>;
  abstract search(
    token: string,
    caseId: string,
    offset: number,
  ): Promise<RecordPage<DocumentSummary>>;
  abstract get(token: string, id: string): Promise<DocumentDetail>;
  abstract categories(token: string): Promise<DocumentCategory[]>;
  abstract authorizeDownload(
    token: string,
    versionId: string,
  ): Promise<{ id: string; sha256: string; size: number }>;
}
