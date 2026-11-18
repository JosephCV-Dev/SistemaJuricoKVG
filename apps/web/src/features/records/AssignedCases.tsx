import { Icon } from '../../shared/ui/Icon';
import { useEffect, useRef, useState } from 'react';
import type { AssignedCase, RecordPage } from '@kvg/contracts';
import type { AssignedFilters } from './records-api';
import { searchAssigned } from './records-api';
import type { RunRecordAction } from './CaseAssignmentPanel';
import { showDate } from './record-format';
import { statusLabel } from './CaseStatusEditor';

const empty = { text: '', status: '', participation: '', from: '', to: '' };
const labels = {
  PRINCIPAL: 'Principal',
  COLABORADOR: 'Colaborador',
  EXPLICITO: 'Acceso explícito',
};

export function AssignedCases({
  busy,
  accessRevision,
  run,
  onOpen,
}: {
  busy: boolean;
  accessRevision: number;
  run: RunRecordAction;
  onOpen: (id: string) => void;
}) {
  const [filters, setFilters] = useState<AssignedFilters>(empty);
  const [query, setQuery] = useState<AssignedFilters>(empty);
  const [results, setResults] = useState<RecordPage<AssignedCase> | null>(null);
  const loaded = useRef(false);
  useEffect(() => setResults(null), [accessRevision]);
  async function load(
    next: AssignedFilters,
    offset: number,
    signal: AbortSignal,
  ) {
    setResults(null);
    setResults(await searchAssigned(next, offset, signal));
    setQuery(next);
  }
  useEffect(() => {
    if (!busy && !loaded.current) {
      loaded.current = true;
      void run((signal) => load(empty, 0, signal));
    }
  }, [busy]);

  return (
    <section className="panel" aria-labelledby="assigned-cases">
      <h2 id="assigned-cases">Buscar expedientes asignados</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run((signal) =>
            load({ ...filters, text: filters.text.trim() }, 0, signal),
          );
        }}
      >
        <fieldset disabled={busy}>
          <legend>Filtros de mis expedientes</legend>
          <p>
            <label htmlFor="assigned-text">
              Folio, referencia o descripción
            </label>
            <input
              id="assigned-text"
              maxLength={200}
              value={filters.text}
              onChange={(event) =>
                setFilters({ ...filters, text: event.target.value })
              }
            />
          </p>
          <p>
            <label htmlFor="assigned-status">Estado</label>
            <select
              id="assigned-status"
              value={filters.status}
              onChange={(event) =>
                setFilters({ ...filters, status: event.target.value })
              }
            >
              <option value="">Todos los estados</option>
              {[
                'NUEVO',
                'EN_PROCESO',
                'PENDIENTE',
                'CONCLUIDO',
                'ARCHIVADO',
              ].map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </p>
          <p>
            <label htmlFor="assigned-participation">Participación</label>
            <select
              id="assigned-participation"
              value={filters.participation}
              onChange={(event) =>
                setFilters({ ...filters, participation: event.target.value })
              }
            >
              <option value="">Todas las participaciones</option>
              {Object.entries(labels).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </p>
          <details className="search-options">
            <summary>
              Fechas de alta
              {filters.from || filters.to ? ' (filtro activo)' : ''}
            </summary>
            <div className="filter-grid">
              <p>
                <label htmlFor="assigned-from">Alta desde (UTC)</label>
                <input
                  id="assigned-from"
                  type="date"
                  value={filters.from}
                  max={filters.to || undefined}
                  onChange={(event) =>
                    setFilters({ ...filters, from: event.target.value })
                  }
                />
              </p>
              <p>
                <label htmlFor="assigned-to">Alta hasta (UTC)</label>
                <input
                  id="assigned-to"
                  type="date"
                  value={filters.to}
                  min={filters.from || undefined}
                  onChange={(event) =>
                    setFilters({ ...filters, to: event.target.value })
                  }
                />
              </p>
            </div>
          </details>
          <button type="submit">
            <Icon name="search" />
            Buscar mis expedientes
          </button>
        </fieldset>
      </form>
      {results &&
        (results.items.length ? (
          <div
            className="table-wrap"
            role="region"
            aria-label="Expedientes asignados"
            tabIndex={0}
          >
            <table>
              <caption className="sr-only">
                Expedientes asignados o con acceso explícito
              </caption>
              <thead>
                <tr>
                  <th scope="col">Folio</th>
                  <th scope="col">Asunto</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Participación</th>
                  <th scope="col">Alta</th>
                </tr>
              </thead>
              <tbody>
                {results.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        disabled={busy}
                        onClick={() => onOpen(item.id)}
                      >
                        <Icon name="folder" />
                        {item.folio}
                      </button>
                    </td>
                    <td>{item.description.slice(0, 120)}</td>
                    <td>
                      <span className="badge">{statusLabel[item.status]}</span>
                    </td>
                    <td>
                      {item.participation
                        .map((part) => labels[part])
                        .join(', ')}
                    </td>
                    <td>{showDate(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No hay expedientes asignados o concedidos con esos filtros.</p>
        ))}
      {results && (
        <div className="actions">
          <button
            className="button-secondary"
            type="button"
            disabled={busy || !results.offset}
            onClick={() =>
              void run((signal) =>
                load(
                  query,
                  Math.max(0, results.offset - results.limit),
                  signal,
                ),
              )
            }
          >
            Expedientes anteriores
          </button>
          <button
            className="button-secondary"
            type="button"
            disabled={busy || !results.hasMore}
            onClick={() =>
              void run((signal) =>
                load(query, results.offset + results.limit, signal),
              )
            }
          >
            Expedientes siguientes
          </button>
        </div>
      )}
    </section>
  );
}
