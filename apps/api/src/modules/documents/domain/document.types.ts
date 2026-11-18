import type { DocumentReviewOutcome, DocumentState } from '@kvg/contracts';

export const MAX_FILE_BYTES = 20_000_000;
export const FILE_MIMES = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  JPG: 'image/jpeg',
  PNG: 'image/png',
} as const;
export type FileFormat = keyof typeof FILE_MIMES;
export interface VerifiedFile {
  format: FileFormat;
  mime: string;
  size: number;
  sha256: string;
  engine: string | null;
}
export class RejectedContent extends Error {}

export const DOCUMENT_STATES = [
  'RECIBIDO',
  'EN_REVISION',
  'VALIDADO',
  'ARCHIVADO',
] as const satisfies readonly DocumentState[];

export const DOCUMENT_REVIEW_OUTCOMES = [
  'OBSERVACIONES',
  'APTO_PARA_VALIDAR',
  'REQUIERE_CORRECCION',
] as const satisfies readonly DocumentReviewOutcome[];
