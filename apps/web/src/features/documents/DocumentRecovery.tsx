import { Icon } from '../../shared/ui/Icon';
import { useEffect, useRef, useState } from 'react';
import type {
  DocumentRecoveryState,
  DocumentRecoveryStatus,
  RecordPage,
  RetiredDocument,
} from '@kvg/contracts';
import type { RunDocumentAction } from './DocumentDetails';
import { documentTimestamp } from './document-format';
import {
  documentRecoveryStatus,
  recoverDocument,
  retiredDocuments,
} from './documents-api';

const labels: Record<DocumentRecoveryState, string> = {
  EN_COLA: 'En cola',
  EN_EJECUCION: 'Verificando originales',
  COMPLETADO: 'Documento recuperado',
  FALLIDO: 'Recuperación fallida',
  CANCELADO: 'Recuperación cancelada',
};

export function DocumentRecovery({
  busy,
  run,
}: {
  busy: boolean;
  run: RunDocumentAction;
}) {
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<RecordPage<RetiredDocument> | null>(null);
  const [selected, setSelected] = useState<RetiredDocument | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<DocumentRecoveryStatus | null>(null);
  const loaded = useRef(false);
  const draft = useRef<{ id: string; key: string } | null>(null);

  function load(next: string, offset: number) {
    void run(async (signal) => {
      setSelected(null);
      setPage(await retiredDocuments(next, offset, signal));
      setQuery(next);
    });
  }
  useEffect(() => {
    if (!busy && !loaded.current) {
      loaded.current = true;
      load('', 0);
    }
  }, [busy]);

  function checkStatus(id: string) {
    void run(async (signal) => {
      const current = await documentRecoveryStatus(id, signal);
      setStatus(current);
      setPage(await retiredDocuments(query, 0, signal));
    });
  }

  return (
    <section className="panel" aria-labelledby="document-recovery">
      <h2 id="document-recovery">Documentos retirados</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          load(filter.trim(), 0);
        }}
      >
        <fieldset disabled={busy}>
          <legend>Buscar documentos retirados</legend>
          <p>
            <label htmlFor="retired-filter">
              Folio del expediente o ID del documento
            </label>
            <input
              id="retired-filter"
              maxLength={40}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </p>
          <button type="submit">
            <Icon name="search" />
            Buscar retirados
          </button>
        </fieldset>
      </form>
      {!page && busy && <p role="status">Consultando documentos retirados…</p>}
      {page?.items.length === 0 && (
        <p>No hay documentos retirados en esta página.</p>
      )}
      {page && page.items.length > 0 && (
        <div
          className="table-wrap"
          role="region"
          aria-label="Resultados de documentos retirados"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Expediente</th>
                <th>ID del documento</th>
                <th>Retirado</th>
                <th>Recuperación</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.caseFolio ?? 'Restringido'}</td>
                  <td>{item.id}</td>
                  <td>{documentTimestamp(item.retiredAt)}</td>
                  <td>
                    <div className="actions">
                      {item.jobId && (
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={busy}
                          onClick={() => checkStatus(item.jobId!)}
                        >
                          Consultar solicitud
                        </button>
                      )}
                      {item.canRecover &&
                        item.jobState !== 'EN_COLA' &&
                        item.jobState !== 'EN_EJECUCION' && (
                          <button
                            type="button"
                            className="button-secondary"
                            disabled={busy}
                            onClick={() => {
                              setSelected(item);
                              setReason('');
                              setStatus(null);
                            }}
                          >
                            <Icon name="restore" />
                            Recuperar documento
                          </button>
                        )}
                    </div>
                    {item.jobState && <p>{labels[item.jobState]}</p>}
                    {!item.canRecover && <p>Recuperación restringida.</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page && (page.hasMore || page.offset > 0) && (
        <div className="actions">
          <button
            type="button"
            className="button-secondary"
            disabled={busy || page.offset === 0}
            onClick={() => load(query, Math.max(0, page.offset - page.limit))}
          >
            Página anterior
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy || !page.hasMore}
            onClick={() => load(query, page.offset + page.limit)}
          >
            Página siguiente
          </button>
        </div>
      )}
      {selected && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = reason.trim();
            if (!trimmed) return;
            const key = JSON.stringify([
              selected.id,
              selected.revision,
              trimmed,
            ]);
            if (draft.current?.key !== key)
              draft.current = { id: crypto.randomUUID(), key };
            const requestId = draft.current.id;
            void run(async (signal) => {
              const result = await recoverDocument(
                selected.id,
                { revision: selected.revision, reason: trimmed, requestId },
                signal,
              );
              draft.current = null;
              setStatus(result);
              setSelected(null);
              setPage(await retiredDocuments(query, 0, signal));
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>Confirmar solicitud de recuperación</legend>
            <p>
              Expediente {selected.caseFolio ?? 'restringido'} · Documento{' '}
              {selected.id}
            </p>
            <p>
              El documento volverá a estar disponible para el equipo autorizado
              cuando se verifiquen todos sus originales.
            </p>
            <p>
              <label htmlFor="recovery-reason">Motivo de la recuperación</label>
              <textarea
                id="recovery-reason"
                required
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </p>
            <div className="actions">
              <button type="submit" disabled={!reason.trim()}>
                Solicitar recuperación
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setSelected(null)}
              >
                Cancelar
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {status && (
        <div className="record-detail">
          <p role="status">
            {labels[status.state]} · Documento {status.documentId}
          </p>
          {status.result === 'ORIGINAL_NO_VERIFICABLE' && (
            <p>
              Al menos un original no pudo verificarse. El documento sigue
              retirado.
            </p>
          )}
          {status.result === 'RECUPERACION_NO_AUTORIZADA' && (
            <p>
              La revisión, los permisos o las restricciones vigentes impidieron
              la recuperación.
            </p>
          )}
          {status.state === 'FALLIDO' &&
            status.result !== 'ORIGINAL_NO_VERIFICABLE' && (
              <p>
                No se completó la comprobación técnica. El documento sigue
                retirado.
              </p>
            )}
          {status.mode === 'BETA' && (
            <p>
              Originales verificados en modo beta, sin análisis antimalware.
            </p>
          )}
          {(status.state === 'EN_COLA' || status.state === 'EN_EJECUCION') && (
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => checkStatus(status.id)}
            >
              Actualizar estado de recuperación
            </button>
          )}
        </div>
      )}
    </section>
  );
}
