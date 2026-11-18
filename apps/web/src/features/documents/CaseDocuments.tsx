import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  DocumentCategory,
  DocumentDetail,
  DocumentSummary,
  RecordPage,
  UploadStatus,
} from '@kvg/contracts';
import { DocumentDetails } from './DocumentDetails';
import { AuthRequestError } from '../../shared/api/session-http';
import {
  categories,
  uploadAvailability,
  createUpload,
  transfer,
  uploadStatus,
  listDocuments,
  getDocument,
} from './documents-api';

const labels = {
  RECIBIENDO: 'Pendiente de recepción',
  PENDIENTE_VERIFICACION: 'En análisis',
  HABILITADO: 'Archivo disponible',
  RECHAZADO: 'Archivo rechazado',
  ERROR_VERIFICACION: 'Análisis pendiente de reintento',
  ABANDONADO: 'Carga abandonada',
};
export function CaseDocuments({
  caseId,
  canUpload,
  canDownload,
  onAccessFailure,
  onOpenCase,
}: {
  caseId: string;
  canUpload: boolean;
  canDownload: boolean;
  onAccessFailure: (status: number) => void;
  onOpenCase?: (id: string) => void;
}) {
  const [page, setPage] = useState<RecordPage<DocumentSummary>>({
    items: [],
    limit: 20,
    offset: 0,
    hasMore: false,
  });
  const [catalog, setCatalog] = useState<DocumentCategory[]>([]);
  const [uploadsEnabled, setUploadsEnabled] = useState<boolean | null>(null);
  const [beta, setBeta] = useState(false);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [file, setFile] = useState<File | null>(null),
    [name, setName] = useState(''),
    [categoryId, setCategory] = useState(''),
    [reason, setReason] = useState('Carga inicial.');
  const [requestId, setRequest] = useState(() => crypto.randomUUID()),
    [locked, setLocked] = useState(false),
    [status, setStatus] = useState<UploadStatus | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const active = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (
          failure instanceof AuthRequestError &&
          [401, 403].includes(failure.status)
        ) {
          setPage({ items: [], limit: 20, offset: 0, hasMore: false });
          setDetail(null);
          onAccessFailure(failure.status);
        }
        setError(
          failure instanceof Error
            ? failure.message
            : 'No se pudo completar la operación documental.',
        );
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    setUploadsEnabled(null);
    void run(async (signal) => {
      setPage(await listDocuments(caseId, 0, signal));
      if (canUpload) {
        const availability = await uploadAvailability(signal);
        setUploadsEnabled(availability.enabled);
        setBeta(availability.beta === true);
        if (availability.enabled) setCatalog(await categories(signal));
      }
    });
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [caseId, canUpload]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || uploadsEnabled !== true) return;
    void run(async (signal) => {
      if (!file.size || file.size > 20_000_000)
        throw new Error('El archivo debe tener entre 1 byte y 20 MB.');
      setLocked(true);
      const created = await createUpload(
        {
          requestId,
          caseId,
          name: name.trim(),
          categoryId,
          originalName: file.name,
          reason: reason.trim(),
        },
        signal,
      );
      setStatus(await transfer(created.id, file, signal));
      setPage(await listDocuments(caseId, 0, signal));
      setNotice(
        beta
          ? 'Archivo recibido. Actualiza documentos para consultar su disponibilidad en la beta.'
          : 'Archivo recibido. Permanecerá bloqueado hasta completar el análisis.',
      );
    });
  }
  return (
    <section aria-label="Documentos del expediente" aria-busy={busy}>
      <div className="section-header">
        <h4>Documentos</h4>
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async (signal) => {
              if (status) setStatus(await uploadStatus(status.id, signal));
              setPage(await listDocuments(caseId, page.offset, signal));
              if (detail) setDetail(await getDocument(detail.id, signal));
            })
          }
        >
          Actualizar documentos
        </button>
      </div>
      <div role="status" aria-live="polite">
        {busy && <p>Procesando documento…</p>}
        {notice && <p>{notice}</p>}
        {status && (
          <p>
            Estado de la carga:{' '}
            {beta && status.state === 'PENDIENTE_VERIFICACION'
              ? 'Preparando descarga beta'
              : labels[status.state]}
            .
          </p>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {canUpload && uploadsEnabled === false && (
        <p role="status">
          Las cargas nuevas están pausadas hasta habilitar la verificación de
          archivos. Puedes consultar los documentos ya disponibles según tus
          permisos.
        </p>
      )}
      {canUpload && uploadsEnabled === true && (
        <details className="upload-panel">
          <summary>Subir documento</summary>
          <p>
            PDF, DOCX, JPG o PNG hasta 20 MB.{' '}
            {beta
              ? 'Beta sin análisis antimalware. Usa archivos ficticios.'
              : 'El archivo se analiza antes de quedar disponible.'}
          </p>
          <form onSubmit={submit}>
            <fieldset disabled={busy || locked}>
              <legend>Archivo y clasificación</legend>
              <p>
                <label htmlFor="document-file">Archivo</label>
                <input
                  ref={fileInput}
                  id="document-file"
                  type="file"
                  accept=".pdf,.docx,.jpg,.jpeg,.png"
                  required
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </p>
              <p>
                <label htmlFor="document-name">Nombre del documento</label>
                <input
                  id="document-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={200}
                  pattern=".*\S.*"
                />
              </p>
              <p>
                <label htmlFor="document-category">Categoría</label>
                <select
                  id="document-category"
                  value={categoryId}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                >
                  <option value="">Selecciona una categoría</option>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </p>
              <p>
                <label htmlFor="document-reason">Motivo de incorporación</label>
                <input
                  id="document-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={2000}
                  required
                  pattern=".*\S.*"
                />
              </p>
              {!locked && (
                <button type="submit">
                  {beta ? 'Subir archivo' : 'Enviar a análisis'}
                </button>
              )}
            </fieldset>
            {locked && (
              <div className="actions">
                <button type="submit" disabled={busy}>
                  Reintentar el mismo archivo
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setLocked(false);
                    setStatus(null);
                    setRequest(crypto.randomUUID());
                    setFile(null);
                    if (fileInput.current) fileInput.current.value = '';
                  }}
                >
                  Preparar otra carga
                </button>
              </div>
            )}
          </form>
        </details>
      )}
      {!busy && !page.items.length && (
        <p>Este expediente no tiene documentos visibles.</p>
      )}
      {page.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">
              Documentos autorizados del expediente
            </caption>
            <thead>
              <tr>
                <th scope="col">Documento</th>
                <th scope="col">Versión</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((d) => (
                <tr key={d.id}>
                  <td>
                    <button
                      className="table-link"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async (signal) =>
                          setDetail(await getDocument(d.id, signal)),
                        )
                      }
                    >
                      {d.name}
                    </button>
                  </td>
                  <td>{d.number === null ? 'Sin publicar' : `v${d.number}`}</td>
                  <td>
                    <span className="badge">{d.status ?? 'No disponible'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="actions">
        <button
          className="button-secondary"
          type="button"
          disabled={busy || !page.offset}
          onClick={() =>
            void run(async (signal) =>
              setPage(
                await listDocuments(
                  caseId,
                  Math.max(0, page.offset - page.limit),
                  signal,
                ),
              ),
            )
          }
        >
          Documentos anteriores
        </button>
        <button
          className="button-secondary"
          type="button"
          disabled={busy || !page.hasMore}
          onClick={() =>
            void run(async (signal) =>
              setPage(
                await listDocuments(caseId, page.offset + page.limit, signal),
              ),
            )
          }
        >
          Documentos siguientes
        </button>
      </p>
      {detail && (
        <DocumentDetails
          key={`${detail.id}:${detail.revision}`}
          detail={detail}
          busy={busy}
          canDownload={canDownload}
          run={run}
          {...(onOpenCase ? { onOpenCase } : {})}
          onDownload={() => setNotice('Descarga autorizada.')}
          onRefresh={() =>
            void run(async (signal) =>
              setDetail(await getDocument(detail.id, signal)),
            )
          }
          onSaved={async (result, signal) => {
            const moved = result.caseId !== detail.caseId;
            setNotice(
              moved ? 'Documento trasladado.' : 'Categoría actualizada.',
            );
            const updated = await getDocument(result.id, signal);
            setDetail(updated);
            setPage(await listDocuments(caseId, 0, signal));
          }}
        />
      )}
    </section>
  );
}
