import { useEffect, useRef, useState } from 'react';
import type {
  AuditCursor,
  AuditEventDetail,
  AuditPage,
  AuditResult,
} from '@kvg/contracts';
import type { RunDocumentAction } from '../documents/DocumentDetails';
import { auditDetail, listAudit } from './administration-api';

const results: Record<AuditResult, string> = {
  EXITO: 'Éxito',
  DENEGADO: 'Denegado',
  FALLIDO: 'Fallido',
  RECIBIDO: 'Recibido',
};
const transferDescriptions: Record<string, string> = {
  AUTORIZACION_DESCARGA: 'El sistema autorizó la descarga.',
  TRANSFERENCIA_VERIFICADA:
    'El sistema registró evidencia de la transferencia.',
};
const utcDate = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'UTC',
});

export function AuditWorkspace({
  busy,
  run,
  autoLoad,
}: {
  busy: boolean;
  run: RunDocumentAction;
  autoLoad: boolean;
}) {
  const [filters, setFilters] = useState(new URLSearchParams());
  const [pages, setPages] = useState<(AuditCursor | null)[]>([null]);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [detail, setDetail] = useState<AuditEventDetail | null>(null);
  const loaded = useRef(false);

  function load(
    nextFilters: URLSearchParams,
    nextPages: (AuditCursor | null)[],
  ) {
    const query = new URLSearchParams(nextFilters);
    const cursor = nextPages.at(-1);
    if (cursor) {
      query.set('beforeAt', cursor.beforeAt);
      query.set('beforeId', cursor.beforeId);
    }
    loaded.current = true;
    void run(async (signal) => {
      setDetail(null);
      const result = await listAudit(query, signal);
      setPage(result);
      setFilters(nextFilters);
      setPages(nextPages);
    });
  }

  useEffect(() => {
    if (autoLoad && !busy && !loaded.current) {
      loaded.current = true;
      load(new URLSearchParams(), [null]);
    }
  }, [autoLoad, busy]);

  return (
    <section className="panel" aria-labelledby="audit-heading">
      <h2 id="audit-heading">Bitácora</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams();
          for (const [key, value] of new FormData(event.currentTarget)) {
            if (typeof value === 'string' && value.trim())
              next.set(key, value.trim());
          }
          load(next, [null]);
        }}
      >
        <fieldset disabled={busy}>
          <legend>Filtrar eventos</legend>
          <p>
            <label htmlFor="audit-from">Desde (UTC)</label>
            <input id="audit-from" name="from" type="date" />
          </p>
          <p>
            <label htmlFor="audit-to">Hasta (UTC)</label>
            <input id="audit-to" name="to" type="date" />
          </p>
          <p>
            <label htmlFor="audit-actor">Actor (nombre o ID)</label>
            <input id="audit-actor" name="actor" maxLength={200} />
          </p>
          <p>
            <label htmlFor="audit-action">Acción</label>
            <input id="audit-action" name="action" maxLength={64} />
          </p>
          <p>
            <label htmlFor="audit-resource">Recurso (tipo o ID)</label>
            <input id="audit-resource" name="resource" maxLength={64} />
          </p>
          <p>
            <label htmlFor="audit-result">Resultado</label>
            <select id="audit-result" name="result">
              <option value="">Todos</option>
              {Object.entries(results).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </p>
          <button type="submit">Consultar bitácora</button>
        </fieldset>
      </form>
      {page?.items.length === 0 && <p>No se encontraron eventos.</p>}
      {page && page.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha (UTC)</th>
                <th>Actor</th>
                <th>Acción</th>
                <th>Recurso</th>
                <th>Resultado</th>
                <th>Correlación</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((event) => (
                <tr key={event.id}>
                  <td>{utcDate.format(new Date(event.at))}</td>
                  <td>{event.actor ?? event.actorType}</td>
                  <td>{event.action}</td>
                  <td>{event.resourceType}</td>
                  <td>{results[event.result]}</td>
                  <td>
                    <code>{event.correlationId}</code>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async (signal) => {
                          setDetail(null);
                          setDetail(await auditDetail(event.id, signal));
                        })
                      }
                    >
                      Ver evento
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page && (pages.length > 1 || page.next) && (
        <div className="actions">
          <button
            type="button"
            className="button-secondary"
            disabled={busy || pages.length === 1}
            onClick={() => load(filters, pages.slice(0, -1))}
          >
            Anterior
          </button>
          <span>Página {pages.length}</span>
          <button
            type="button"
            className="button-secondary"
            disabled={busy || !page.next}
            onClick={() => load(filters, [...pages, page.next])}
          >
            Siguiente
          </button>
        </div>
      )}
      {detail && (
        <section aria-labelledby="audit-detail">
          <h3 id="audit-detail">Detalle del evento</h3>
          {detail.result === 'EXITO' &&
            Object.hasOwn(transferDescriptions, detail.action) && (
              <p>{transferDescriptions[detail.action]}</p>
            )}
          <dl>
            <dt>Evento</dt>
            <dd>{detail.id}</dd>
            <dt>Acción</dt>
            <dd>{detail.action}</dd>
            <dt>Resultado</dt>
            <dd>{results[detail.result]}</dd>
            <dt>Tipo de actor</dt>
            <dd>{detail.actorType}</dd>
            {detail.actorId && (
              <>
                <dt>ID del actor</dt>
                <dd>{detail.actorId}</dd>
              </>
            )}
            <dt>Tipo de recurso</dt>
            <dd>{detail.resourceType}</dd>
            {detail.resourceId && (
              <>
                <dt>ID del recurso</dt>
                <dd>{detail.resourceId}</dd>
              </>
            )}
            <dt>Correlación</dt>
            <dd>{detail.correlationId}</dd>
            {detail.revision !== null && (
              <>
                <dt>Revisión</dt>
                <dd>{detail.revision}</dd>
              </>
            )}
            {detail.quantity !== null && (
              <>
                <dt>Cantidad</dt>
                <dd>{detail.quantity}</dd>
              </>
            )}
          </dl>
          <button
            type="button"
            className="button-secondary"
            onClick={() => setDetail(null)}
          >
            Cerrar detalle
          </button>
        </section>
      )}
    </section>
  );
}
