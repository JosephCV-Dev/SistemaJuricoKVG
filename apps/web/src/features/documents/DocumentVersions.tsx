import { Icon } from '../../shared/ui/Icon';
import { useEffect, useId, useRef, useState } from 'react';
import type {
  DocumentDetail,
  DocumentUploadAvailability,
  DocumentVersionHistoryEntry,
  DocumentVersionUploadInput,
  RecordPage,
  UploadStatus,
} from '@kvg/contracts';
import type { RunDocumentAction } from './DocumentDetails';
import {
  createVersionUpload,
  documentVersions,
  saveDocumentDownload,
  transfer,
  uploadAvailability,
  uploadStatus,
} from './documents-api';

import {
  documentStateLabel,
  documentTimestamp,
  fileSizeLabel,
} from './document-format';

function uploadMessage(status: UploadStatus): string {
  switch (status.state) {
    case 'HABILITADO':
      return 'La nueva versión quedó vigente.';
    case 'RECHAZADO':
      return 'El archivo fue rechazado. Se conserva la versión vigente.';
    case 'ERROR_VERIFICACION':
      return 'El análisis no pudo completarse. Se conserva la versión vigente.';
    case 'ABANDONADO':
      return status.result === 'CONFLICTO_REVISION'
        ? 'El documento cambió durante la carga. Actualiza la ficha antes de empezar otro intento.'
        : 'La publicación se canceló. Revisa la ficha y los permisos vigentes.';
    default:
      return 'Archivo recibido. La versión vigente se conserva hasta que se publique la nueva.';
  }
}

export function DocumentVersions({
  detail,
  active,
  reviewFirst,
  busy,
  run,
  onPublished,
  onRefresh,
  onDownload,
  onOpenReview,
}: {
  detail: DocumentDetail;
  active: boolean;
  reviewFirst: boolean;
  busy: boolean;
  run: RunDocumentAction;
  onPublished: (signal: AbortSignal) => Promise<void>;
  onRefresh: () => void;
  onDownload: () => void;
  onOpenReview: (versionId: string) => void;
}) {
  const formId = useId();
  const historyRequested = useRef(false);
  const [history, setHistory] =
    useState<RecordPage<DocumentVersionHistoryEntry> | null>(null);
  const [availability, setAvailability] =
    useState<DocumentUploadAvailability | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [attempt, setAttempt] = useState<DocumentVersionUploadInput | null>(
    null,
  );
  const [status, setStatus] = useState<UploadStatus | null>(null);

  function loadHistory(offset: number) {
    historyRequested.current = true;
    void run(async (signal) => {
      setHistory(await documentVersions(detail.id, offset, signal));
    });
  }

  useEffect(() => {
    if (active && !busy && detail.canViewVersions && !historyRequested.current)
      loadHistory(0);
  }, [active, busy, detail.canViewVersions]);

  function resetUpload() {
    setAvailability(null);
    setFile(null);
    setReason('');
    setAttempt(null);
    setStatus(null);
  }

  return (
    <>
      <div className="actions">
        {detail.canUploadVersion && !availability && (
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() =>
              void run(async (signal) =>
                setAvailability(await uploadAvailability(signal)),
              )
            }
          >
            <Icon name="upload" />
            Cargar nueva versión
          </button>
        )}
      </div>
      {availability && !availability.enabled && (
        <p>Las cargas están pausadas.</p>
      )}
      {availability?.enabled && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!file || status) return;
            void run(async (signal) => {
              if (!file.size || file.size > 20_000_000)
                throw new Error('El archivo debe tener entre 1 byte y 20 MB.');
              const input = attempt ?? {
                requestId: crypto.randomUUID(),
                revision: detail.revision,
                originalName: file.name,
                reason: reason.trim(),
              };
              setAttempt(input);
              const upload = await createVersionUpload(
                detail.id,
                input,
                signal,
              );
              const next =
                upload.state === 'RECIBIENDO'
                  ? await transfer(upload.id, file, signal)
                  : await uploadStatus(upload.id, signal);
              setStatus(next);
              if (next.state === 'HABILITADO') await onPublished(signal);
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>Nueva versión</legend>
            {availability.beta && (
              <p>La carga beta se publicará sin análisis antimalware.</p>
            )}
            {!status && (
              <>
                <p>
                  <label htmlFor={`${formId}-file`}>Archivo nuevo</label>
                  <input
                    id={`${formId}-file`}
                    type="file"
                    accept=".pdf,.docx,.jpg,.jpeg,.png"
                    required={!attempt}
                    disabled={Boolean(attempt)}
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                </p>
                <p>
                  <label htmlFor={`${formId}-reason`}>
                    Motivo de la nueva versión
                  </label>
                  <textarea
                    id={`${formId}-reason`}
                    value={reason}
                    maxLength={2000}
                    required
                    readOnly={Boolean(attempt)}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </p>
              </>
            )}
            {status && <p role="status">{uploadMessage(status)}</p>}
            <div className="actions">
              {!status && (
                <button type="submit" disabled={!file || !reason.trim()}>
                  {attempt
                    ? 'Reintentar carga de versión'
                    : 'Enviar nueva versión'}
                </button>
              )}
              {status &&
                [
                  'PENDIENTE_VERIFICACION',
                  'ERROR_VERIFICACION',
                  'HABILITADO',
                ].includes(status.state) && (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() =>
                      void run(async (signal) => {
                        const next = await uploadStatus(status.id, signal);
                        setStatus(next);
                        if (next.state === 'HABILITADO')
                          await onPublished(signal);
                      })
                    }
                  >
                    Consultar estado de la nueva versión
                  </button>
                )}
              <button
                type="button"
                className="button-secondary"
                onClick={resetUpload}
              >
                {attempt ? 'Cerrar formulario' : 'Cancelar carga'}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={onRefresh}
              >
                Actualizar ficha
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {detail.canViewVersions && (
        <section aria-labelledby={`${formId}-history`}>
          <h3 id={`${formId}-history`}>Historial de versiones</h3>
          <div className="actions">
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => loadHistory(0)}
            >
              Actualizar historial
            </button>
          </div>
          {!history && busy && <p role="status">Consultando versiones…</p>}
          {history?.items.length === 0 && (
            <p>No hay versiones disponibles en esta página.</p>
          )}
          {history && history.items.length > 0 && (
            <ol className="document-version-history">
              {history.items.map((item) => (
                <li key={item.id}>
                  <p>
                    <strong>
                      Versión {item.number}
                      {item.current ? ' · Vigente' : ''}
                    </strong>
                    {' · '}
                    {documentStateLabel(item.status)}
                  </p>
                  <p>
                    {item.author} · {documentTimestamp(item.publishedAt)}
                  </p>
                  <p>Motivo: {item.reason}</p>
                  <p>
                    {item.format} · {fileSizeLabel(item.size)}
                  </p>
                  {item.beta && <p>Archivo beta sin análisis antimalware.</p>}
                  {item.reviews.length > 0 && (
                    <ul
                      aria-label={`Revisiones jurídicas de la versión ${item.number}`}
                    >
                      {item.reviews.map((review) => (
                        <li key={review.id}>
                          {review.result.replaceAll('_', ' ')} · {review.author}{' '}
                          · {documentTimestamp(review.at)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.integrityHash && (
                    <details className="version-integrity">
                      <summary>Datos de integridad</summary>
                      <p>
                        SHA-256 <code>{item.integrityHash}</code>
                      </p>
                    </details>
                  )}
                  <div className="actions">
                    {item.canDownload && (
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async (signal) => {
                            await saveDocumentDownload(
                              detail.name,
                              item,
                              signal,
                            );
                            onDownload();
                          })
                        }
                      >
                        Descargar versión {item.number}
                      </button>
                    )}
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy}
                      onClick={() => onOpenReview(item.id)}
                    >
                      {reviewFirst ? 'Revisión y estado' : 'Estado'} de la
                      versión {item.number}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {history && (history.offset > 0 || history.hasMore) && (
            <div className="actions">
              <button
                type="button"
                className="button-secondary"
                disabled={busy || history.offset === 0}
                onClick={() =>
                  loadHistory(Math.max(0, history.offset - history.limit))
                }
              >
                Versiones anteriores de la lista
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={busy || !history.hasMore}
                onClick={() => loadHistory(history.offset + history.limit)}
              >
                Siguiente página de versiones
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
