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
