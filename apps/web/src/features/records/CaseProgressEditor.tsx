import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CaseProgress,
  CaseProgressInput,
  CaseProgressReference,
  RecordPage,
} from '@kvg/contracts';
import type { RunRecordAction } from './CaseAssignmentPanel';
import { getProgressReferences } from './records-api';
import { showDate } from './record-format';

export function CaseProgressEditor({
  caseId,
  original,
  busy,
  run,
  onSave,
  onCancel,
}: {
  caseId: string;
  original: CaseProgress | null;
  busy: boolean;
  run: RunRecordAction;
  onSave: (input: CaseProgressInput) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState('');
  const [occurredOn, setOccurredOn] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] =
    useState<RecordPage<CaseProgressReference> | null>(null);
  const [selected, setSelected] = useState<CaseProgressReference[]>([]);
  const draft = useRef<{ id: string; serialized: string } | null>(null);

  function findReferences(text: string, offset: number) {
    void run(async (signal) => {
      setResults(null);
      setResults(await getProgressReferences(caseId, text, offset, signal));
      setQuery(text);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!description.trim() || (occurredOn && !source.trim())) return;
    const data = {
      description: description.trim(),
      ...(original ? { correctsId: original.id } : {}),
      ...(occurredOn ? { occurredOn } : {}),
      ...(source.trim() ? { source: source.trim() } : {}),
      ...(selected.length
        ? { versionIds: selected.map((item) => item.versionId).sort() }
        : {}),
    };
    const serialized = JSON.stringify(data);
    if (draft.current?.serialized !== serialized)
      draft.current = { id: crypto.randomUUID(), serialized };
    onSave({ ...data, requestId: draft.current.id });
  }

  return (
    <section aria-labelledby="progress-editor-heading">
      <h5 id="progress-editor-heading">
        {original ? 'Registrar corrección' : 'Registrar avance'}
      </h5>
      {original && (
        <p>
          Corrige la entrada del {showDate(original.at)}
          {original.authorName ? ` de ${original.authorName}` : ''}.
        </p>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <legend>Datos del seguimiento</legend>
          <p>
            <label htmlFor="case-progress-description">
              Descripción del avance
            </label>
            <textarea
              id="case-progress-description"
              required
              maxLength={4000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </p>
          <p>
            <label htmlFor="case-progress-date">
              Fecha del hecho (opcional)
            </label>
            <input
              id="case-progress-date"
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
            />
          </p>
          <p>
            <label htmlFor="case-progress-source">
              Procedencia{occurredOn ? ' (obligatoria)' : ' (opcional)'}
            </label>
            <input
              id="case-progress-source"
              maxLength={512}
              value={source}
              required={Boolean(occurredOn)}
              onChange={(event) => setSource(event.target.value)}
            />
          </p>
        </fieldset>
        {selected.length > 0 && (
          <ul aria-label="Referencias seleccionadas">
            {selected.map((item) => (
              <li key={item.versionId}>
                {item.name} · v{item.number}{' '}
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() =>
                    setSelected((current) =>
                      current.filter(
                        (value) => value.versionId !== item.versionId,
                      ),
                    )
                  }
                >
                  Quitar referencia
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button type="submit" disabled={busy || !description.trim()}>
            Guardar avance
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancelar
          </button>
        </div>
      </form>
      <details>
        <summary>Vincular versiones de documentos</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            findReferences(search.trim(), 0);
          }}
        >
          <fieldset disabled={busy}>
            <legend>Buscar versiones autorizadas</legend>
            <p>
              <label htmlFor="case-progress-document">
                Nombre del documento
              </label>
              <input
                id="case-progress-document"
                maxLength={200}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </p>
            <button type="submit">Buscar versiones</button>
          </fieldset>
        </form>
        {results &&
          (results.items.length ? (
            <ul>
              {results.items.map((item) => (
                <li key={item.versionId}>
                  <button
                    className="table-link"
                    type="button"
                    disabled={
                      busy ||
                      selected.length >= 50 ||
                      selected.some(
                        (value) => value.versionId === item.versionId,
                      )
                    }
                    onClick={() => setSelected((current) => [...current, item])}
                  >
                    Vincular {item.name} · v{item.number}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No hay versiones autorizadas con ese nombre.</p>
          ))}
        {results && (
          <div className="actions">
            <button
              className="button-secondary"
              type="button"
              disabled={busy || !results.offset}
              onClick={() =>
                findReferences(
                  query,
                  Math.max(0, results.offset - results.limit),
                )
              }
            >
              Versiones anteriores
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={busy || !results.hasMore}
              onClick={() =>
                findReferences(query, results.offset + results.limit)
              }
            >
              Versiones siguientes
            </button>
          </div>
        )}
      </details>
    </section>
  );
}
