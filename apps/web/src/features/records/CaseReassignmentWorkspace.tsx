import { Icon } from '../../shared/ui/Icon';
import { useState } from 'react';
import type { CaseAssignmentSummary, RecordPage } from '@kvg/contracts';
import {
  CaseAssignmentPanel,
  type RunRecordAction,
} from './CaseAssignmentPanel';
import { searchReassignable } from './records-api';

export function CaseReassignmentWorkspace({
  busy,
  run,
  onSaved,
}: {
  busy: boolean;
  run: RunRecordAction;
  onSaved: () => void;
}) {
  const [folio, setFolio] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] =
    useState<RecordPage<CaseAssignmentSummary> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function search(term: string, offset: number, signal: AbortSignal) {
    setResults(null);
    setResults(await searchReassignable(term, offset, signal));
    setQuery(term);
  }

  return (
    <section className="panel" aria-labelledby="reassign-cases">
      <h2 id="reassign-cases">Reasignación de expedientes</h2>
      {selected ? (
        <CaseAssignmentPanel
          key={selected}
          id={selected}
          reassign
          busy={busy}
          run={run}
          onBack={() => setSelected(null)}
          onSaved={async (signal) => {
            setSelected(null);
            onSaved();
            await search(query, 0, signal);
          }}
        />
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run((signal) => search(folio.trim(), 0, signal));
            }}
          >
            <fieldset disabled={busy}>
              <legend>Localizar expediente por folio</legend>
              <p>
                <label htmlFor="reassign-folio">Folio interno</label>
                <input
                  id="reassign-folio"
                  value={folio}
                  required
                  maxLength={40}
                  pattern=".*\S.*"
                  onChange={(event) => setFolio(event.target.value)}
                />
              </p>
              <button type="submit">
                <Icon name="search" />
                Buscar expediente para reasignar
              </button>
            </fieldset>
          </form>
          {results &&
            (results.items.length ? (
              <ul>
                {results.items.map((item) => (
                  <li key={item.id}>
                    <button
                      className="table-link"
                      disabled={busy}
                      type="button"
                      onClick={() => setSelected(item.id)}
                    >
                      {item.folio}
                    </button>
                    {' · '}
                    {item.status.replaceAll('_', ' ')}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No hay expedientes disponibles para reasignar con ese folio.
              </p>
            ))}
          {results && (
            <div className="actions">
              <button
                className="button-secondary"
                disabled={busy || !results.offset}
                type="button"
                onClick={() =>
                  void run((signal) =>
                    search(
                      query,
                      Math.max(0, results.offset - results.limit),
                      signal,
                    ),
                  )
                }
              >
                Folios anteriores
              </button>
              <button
                className="button-secondary"
                disabled={busy || !results.hasMore}
                type="button"
                onClick={() =>
                  void run((signal) =>
                    search(query, results.offset + results.limit, signal),
                  )
                }
              >
                Folios siguientes
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
