import { Icon } from '../../shared/ui/Icon';
import { useId, useRef, useState } from 'react';
import type {
  DocumentReviewOutcome,
  DocumentState,
  DocumentVersionReview,
} from '@kvg/contracts';
import type { RunDocumentAction } from './DocumentDetails';
import {
  documentReviewLabels,
  documentStateLabels,
  documentTimestamp,
} from './document-format';
import {
  changeDocumentState,
  documentVersionReview,
  saveDocumentReview,
} from './documents-api';

export function DocumentReview({
  documentId,
  workspace,
  reviewFirst,
  busy,
  run,
  onClose,
  onRefreshDocument,
  onChanged,
  onWorkspaceChange,
}: {
  documentId: string;
  workspace: DocumentVersionReview;
  reviewFirst: boolean;
  busy: boolean;
  run: RunDocumentAction;
  onClose: () => void;
  onRefreshDocument: () => void;
  onChanged: (signal: AbortSignal, status: DocumentState) => Promise<void>;
  onWorkspaceChange: (workspace: DocumentVersionReview) => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [observations, setObservations] = useState('');
  const [result, setResult] = useState<DocumentReviewOutcome>('OBSERVACIONES');
  const [correctsId, setCorrectsId] = useState('');
  const request = useRef<{ id: string; serialized: string } | null>(null);
  const [destination, setDestination] = useState<DocumentState | ''>('');
  const [reason, setReason] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [notice, setNotice] = useState('');
  const { versionId, number, current, canReview, timeline } = workspace;
  const transition = workspace.transitions.find(
    (item) => item.status === destination,
  );
  const suitable = timeline.items.filter(
    (item) =>
      item.kind === 'review' &&
      item.result === 'APTO_PARA_VALIDAR' &&
      !item.superseded,
  );

  async function refresh(offset: number, signal: AbortSignal) {
    onWorkspaceChange(
      await documentVersionReview(documentId, versionId, offset, signal),
    );
    if (offset !== timeline.offset) setReviewId('');
  }

  function startReview(previousId = '') {
    request.current = null;
    setObservations('');
    setResult('OBSERVACIONES');
    setCorrectsId(previousId);
    setEditing(true);
    setNotice('');
  }

  return (
    <section aria-labelledby={id + '-title'}>
      <h3 id={id + '-title'}>
        {reviewFirst ? 'Revisión y estado' : 'Estado'} de la versión {number}
      </h3>
      <p>
        <strong>{documentStateLabels[workspace.status]}</strong>
        {' · '}
        {current ? 'Versión vigente' : 'Versión anterior'}
      </p>
      {!current && (
        <p>Los cambios de estado se aplican a la versión vigente.</p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="actions">
        {canReview && !editing && (
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() => startReview()}
          >
            <Icon name="review" />
            Nueva revisión jurídica
          </button>
        )}
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => void run((signal) => refresh(0, signal))}
        >
          {reviewFirst ? 'Actualizar revisión y estado' : 'Actualizar estado'}
        </button>
        {!current && (
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={onRefreshDocument}
          >
            Actualizar ficha del documento
          </button>
        )}
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={onClose}
        >
          Volver a la ficha
        </button>
      </div>
      {editing && canReview && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!observations.trim()) return;
            const input = {
              result,
              observations: observations.trim(),
              ...(correctsId ? { correctsId } : {}),
            };
            const serialized = JSON.stringify(input);
            if (request.current?.serialized !== serialized)
              request.current = { id: crypto.randomUUID(), serialized };
            const requestId = request.current.id;
            void run(async (signal) => {
              const saved = await saveDocumentReview(
                documentId,
                versionId,
                { ...input, requestId },
                signal,
              );
              request.current = null;
              setEditing(false);
              setNotice(
                saved.currentVersionChanged
                  ? `Revisión guardada en la versión ${number}. La versión vigente cambió.`
                  : 'Revisión jurídica guardada.',
              );
              await refresh(0, signal);
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>
              {correctsId ? 'Corregir revisión' : 'Registrar revisión jurídica'}
            </legend>
            <p>
              <label htmlFor={id + '-outcome'}>Resultado de revisión</label>
              <select
                id={id + '-outcome'}
                value={result}
                onChange={(event) =>
                  setResult(event.target.value as DocumentReviewOutcome)
                }
              >
                {Object.entries(documentReviewLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </p>
            <p>
              <label htmlFor={id + '-observations'}>
                Observaciones jurídicas
              </label>
              <textarea
                id={id + '-observations'}
                required
                maxLength={4000}
                rows={4}
                value={observations}
                onChange={(event) => setObservations(event.target.value)}
              />
            </p>
            <div className="actions">
              <button type="submit" disabled={!observations.trim()}>
                Guardar revisión
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setEditing(false)}
              >
                Cancelar revisión
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {workspace.transitions.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !transition ||
              !reason.trim() ||
              (transition.requiresReview && !reviewId)
            )
              return;
            void run(async (signal) => {
              const saved = await changeDocumentState(
                documentId,
                versionId,
                {
                  revision: workspace.revision,
                  status: transition.status,
                  reason: reason.trim(),
                  ...(transition.requiresReview ? { reviewId } : {}),
                },
                signal,
              );
              setDestination('');
              setReason('');
              setReviewId('');
              await refresh(0, signal);
              await onChanged(signal, saved.status);
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>Cambiar estado documental</legend>
            <p>
              <label htmlFor={id + '-destination'}>Estado de destino</label>
              <select
                id={id + '-destination'}
                value={transition?.status ?? ''}
                required
                onChange={(event) => {
                  setDestination(event.target.value as DocumentState | '');
                  setReviewId('');
                }}
              >
                <option value="">Selecciona un estado</option>
                {workspace.transitions.map(({ status }) => (
                  <option key={status} value={status}>
                    {documentStateLabels[status]}
                    {status === 'RECIBIDO' && ' (pedir corrección)'}
                    {workspace.status === 'ARCHIVADO' && ' (reactivar)'}
                  </option>
                ))}
              </select>
            </p>
            {transition?.requiresReview && (
              <p>
                <label htmlFor={id + '-evidence'}>
                  Revisión apta de esta versión
                </label>
                <select
                  id={id + '-evidence'}
                  value={reviewId}
                  required
                  onChange={(event) => setReviewId(event.target.value)}
                >
                  <option value="">Selecciona una revisión apta</option>
                  {suitable.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.author} · {documentTimestamp(item.at)}
                    </option>
                  ))}
                </select>
                {!suitable.length && (
                  <span>
                    {' '}
                    Esta página no contiene una revisión apta vigente.
                  </span>
                )}
              </p>
            )}
            <p>
              <label htmlFor={id + '-reason'}>
                Motivo del cambio de estado
              </label>
              <textarea
                id={id + '-reason'}
                maxLength={2000}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </p>
            <button
              type="submit"
              disabled={
                !transition ||
                !reason.trim() ||
                (transition.requiresReview && !reviewId)
              }
            >
              Guardar estado documental
            </button>
          </fieldset>
        </form>
      )}
      <h6>Historial de revisión y estado</h6>
      {timeline.items.length === 0 && <p>No hay eventos en esta página.</p>}
      <ol className="document-version-history">
        {timeline.items.map((item) => (
          <li key={item.id}>
            {item.kind === 'review' ? (
              <>
                <strong>{documentReviewLabels[item.result]}</strong>
                {item.superseded && ' · Revisión corregida'}
                {item.correctsId && ' · Corrección de una revisión anterior'}
                <p>
                  {item.author} · {documentTimestamp(item.at)}
                </p>
                <p className="document-observations">{item.observations}</p>
                {canReview && !item.superseded && !editing && (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => startReview(item.id)}
                  >
                    Corregir esta revisión
                  </button>
                )}
              </>
            ) : (
              <>
                <strong>
                  {item.previous
                    ? `${documentStateLabels[item.previous]} → ${documentStateLabels[item.status]}`
                    : `Publicación · ${documentStateLabels[item.status]}`}
                </strong>
                {item.reviewId && ' · Con revisión jurídica'}
                <p>
                  {item.author} · {documentTimestamp(item.at)}
                </p>
                <p className="document-observations">{item.reason}</p>
              </>
            )}
          </li>
        ))}
      </ol>
      {(timeline.offset > 0 || timeline.hasMore) && (
        <div className="actions">
          <button
            type="button"
            className="button-secondary"
            disabled={busy || !timeline.offset}
            onClick={() =>
              void run((signal) =>
                refresh(Math.max(timeline.offset - timeline.limit, 0), signal),
              )
            }
          >
            Página anterior del historial
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy || !timeline.hasMore}
            onClick={() =>
              void run((signal) =>
                refresh(timeline.offset + timeline.limit, signal),
              )
            }
          >
            Página siguiente del historial
          </button>
        </div>
      )}
    </section>
  );
}
