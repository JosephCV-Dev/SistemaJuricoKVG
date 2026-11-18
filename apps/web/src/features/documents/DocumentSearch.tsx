import { useEffect, useRef, useState } from 'react';
import type {
  DocumentCategory,
  DocumentDetail,
  DocumentFilters,
  DocumentSummary,
  RecordPage,
} from '@kvg/contracts';
import {
  documentDate,
  DocumentDetails,
  type RunDocumentAction,
} from './DocumentDetails';
import { categories, getDocument, searchDocuments } from './documents-api';

const defaults: DocumentFilters = { order: 'recientes' };
const states = ['RECIBIDO', 'EN_REVISION', 'VALIDADO', 'ARCHIVADO'] as const;
export function DocumentSearch({
  busy,
  run,
  accessRevision,
  canDownload,
  onOpenCase,
  onNotice,
}: {
  busy: boolean;
  run: RunDocumentAction;
  accessRevision: number;
  canDownload: boolean;
  onOpenCase: (id: string) => void;
  onNotice: (message: string) => void;
}) {
  const [filters, setFilters] = useState<DocumentFilters>(defaults);
  const [query, setQuery] = useState<DocumentFilters>(defaults);
  const [catalog, setCatalog] = useState<DocumentCategory[]>([]);
  const [results, setResults] = useState<RecordPage<DocumentSummary> | null>(
    null,
  );
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!busy && !loaded.current) {
      loaded.current = true;
      void run(async (signal) => {
        setCatalog(await categories(signal, true));
        setResults(await searchDocuments(defaults, 0, signal));
      });
    }
  }, [busy]);
  useEffect(() => {
    setDetail(null);
    setResults(null);
  }, [accessRevision]);

  function load(next: DocumentFilters, offset: number) {
    void run(async (signal) => {
      setResults(null);
      setDetail(null);
      setResults(await searchDocuments(next, offset, signal));
      setQuery(next);
    });
  }

  return (
    <section className="panel" aria-labelledby="document-search">
      <h2 id="document-search">Buscar documentos</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          load(
            {
              ...filters,
              text: filters.text?.trim() ?? '',
              folio: filters.folio?.trim() ?? '',
              client: filters.client?.trim() ?? '',
            },
            0,
          );
        }}
      >
        <fieldset disabled={busy}>
          <legend>Filtros documentales</legend>
          <p>
            <label htmlFor="doc-search-name">Nombre del documento</label>
            <input
              id="doc-search-name"
              value={filters.text ?? ''}
              maxLength={200}
              onChange={(event) =>
                setFilters({ ...filters, text: event.target.value })
              }
            />
          </p>
          <p>
            <label htmlFor="doc-search-category">Categoría</label>
            <select
              id="doc-search-category"
              value={filters.categoryId ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, categoryId: event.target.value })
              }
            >
              <option value="">Todas las categorías</option>
              {catalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </p>
          <p>
            <label htmlFor="doc-search-folio">Folio del expediente</label>
            <input
              id="doc-search-folio"
              value={filters.folio ?? ''}
              maxLength={40}
              onChange={(event) =>
                setFilters({ ...filters, folio: event.target.value })
              }
            />
          </p>
          <p>
            <label htmlFor="doc-search-client">Nombre del cliente</label>
            <input
              id="doc-search-client"
              value={filters.client ?? ''}
              maxLength={200}
              onChange={(event) =>
                setFilters({ ...filters, client: event.target.value })
              }
            />
          </p>
          <p>
            <label htmlFor="doc-search-from">Registro desde (UTC)</label>
            <input
              id="doc-search-from"
              type="date"
              value={filters.from ?? ''}
              max={filters.to || undefined}
              onChange={(event) =>
                setFilters({ ...filters, from: event.target.value })
              }
            />
          </p>
          <p>
            <label htmlFor="doc-search-to">Registro hasta (UTC)</label>
            <input
              id="doc-search-to"
              type="date"
              value={filters.to ?? ''}
              min={filters.from || undefined}
              onChange={(event) =>
                setFilters({ ...filters, to: event.target.value })
              }
            />
          </p>
          <p>
            <label htmlFor="doc-search-status">Estado documental</label>
            <select
              id="doc-search-status"
              value={filters.status ?? ''}
              onChange={(event) => {
                const selected = states.find(
                  (value) => value === event.target.value,
                );
                const { status: _previous, ...remaining } = filters;
                setFilters(
                  selected ? { ...remaining, status: selected } : remaining,
                );
              }}
            >
              <option value="">Todos los estados</option>
              {states.map((item) => (
                <option key={item} value={item}>
                  {item.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </p>
          <p>
            <label htmlFor="doc-search-order">Orden</label>
            <select
              id="doc-search-order"
              value={filters.order}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  order: event.target.value as NonNullable<
                    DocumentFilters['order']
                  >,
                })
              }
            >
              <option value="recientes">Más recientes</option>
              <option value="antiguos">Más antiguos</option>
              <option value="nombre">Nombre</option>
            </select>
          </p>
          <button type="submit">Buscar documentos</button>
        </fieldset>
      </form>
      {results &&
        (results.items.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Documentos encontrados</caption>
              <thead>
                <tr>
                  <th scope="col">Documento</th>
                  <th scope="col">Expediente</th>
                  <th scope="col">Categoría</th>
                  <th scope="col">Registro</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {results.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button
                        type="button"
                        className="table-link"
                        disabled={busy}
                        onClick={() =>
                          void run(async (signal) => {
                            setDetail(null);
                            setDetail(await getDocument(row.id, signal));
                          })
                        }
                      >
                        {row.name}
                      </button>
                    </td>
                    <td>{row.caseFolio ?? 'Folio restringido'}</td>
                    <td>{row.categoryName ?? 'Sin categoría visible'}</td>
                    <td>
                      {row.createdAt
                        ? documentDate(row.createdAt)
                        : 'Sin fecha'}
                    </td>
                    <td>
                      {row.status?.replaceAll('_', ' ') ?? 'No disponible'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            No hay documentos publicados que coincidan con tus filtros y
            permisos.
          </p>
        ))}
      {results && (results.offset > 0 || results.hasMore) && (
        <div className="actions">
          <button
            type="button"
            className="button-secondary"
            disabled={busy || !results.offset}
            onClick={() =>
              load(query, Math.max(0, results.offset - results.limit))
            }
          >
            Documentos anteriores
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy || !results.hasMore}
            onClick={() => load(query, results.offset + results.limit)}
          >
            Documentos siguientes
          </button>
        </div>
      )}
      {detail && (
        <DocumentDetails
          key={`${detail.id}:${detail.revision}`}
          detail={detail}
          busy={busy}
          run={run}
          canDownload={canDownload}
          onOpenCase={onOpenCase}
          onRefresh={() =>
            void run(async (signal) =>
              setDetail(await getDocument(detail.id, signal)),
            )
          }
          onDownload={() => onNotice('Descarga autorizada.')}
          onSaved={async (result, signal) => {
            onNotice(
              result.caseId === detail.caseId
                ? 'Categoría actualizada.'
                : 'Documento trasladado.',
            );
            setDetail(await getDocument(result.id, signal));
            setResults(await searchDocuments(query, 0, signal));
          }}
        />
      )}
    </section>
  );
}
