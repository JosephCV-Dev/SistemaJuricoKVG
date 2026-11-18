import type { DocumentReviewOutcome, DocumentState } from '@kvg/contracts';

export const documentStateLabels: Record<DocumentState, string> = {
  RECIBIDO: 'Recibido',
  EN_REVISION: 'En revisión',
  VALIDADO: 'Validado',
  ARCHIVADO: 'Archivado',
};

export const documentReviewLabels: Record<DocumentReviewOutcome, string> = {
  OBSERVACIONES: 'Observaciones',
  APTO_PARA_VALIDAR: 'Apto para validar',
  REQUIERE_CORRECCION: 'Requiere corrección',
};

const timestamp = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Merida',
});

export const documentTimestamp = (value: string) =>
  timestamp.format(new Date(value));

export function documentStateLabel(value: string): string {
  return Object.hasOwn(documentStateLabels, value)
    ? documentStateLabels[value as DocumentState]
    : value.replaceAll('_', ' ');
}

const fileSize = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return fileSize.format(bytes / (1024 * 1024)) + ' MB';
  if (bytes >= 1024) return fileSize.format(bytes / 1024) + ' KB';
  return fileSize.format(bytes) + ' bytes';
}
