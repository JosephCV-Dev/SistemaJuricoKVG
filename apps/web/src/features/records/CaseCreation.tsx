import { useState } from 'react';
import type { FormEvent } from 'react';
import type { CaseInput, CaseSummary, ClientDetail } from '@kvg/contracts';
import { createCase } from './records-api';

export function CaseCreation({
  client,
  busy,
  run,
  onCreated,
  setError,
}: {
  client: ClientDetail;
  busy: boolean;
  run: (action: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  onCreated: (record: CaseSummary, signal: AbortSignal) => Promise<void>;
  setError: (message: string) => void;
}) {
  const [description, setDescription] = useState('');
  const [externalNumber, setExternalNumber] = useState('');
  const [externalAuthority, setExternalAuthority] = useState('');
  const [caseDraft, setCaseDraft] = useState<CaseInput | null>(null);
  function reviewCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Boolean(externalNumber.trim()) !== Boolean(externalAuthority.trim())) {
      setError(
        'Completa juntos el número externo y su autoridad, o deja ambos vacíos.',
      );
      return;
    }
    setError('');
    setCaseDraft({
      requestId: crypto.randomUUID(),
      clientId: client.id,
      description: description.trim(),
      ...(externalNumber.trim()
        ? {
            externalNumber: externalNumber.trim(),
            externalAuthority: externalAuthority.trim(),
          }
        : {}),
    });
  }
  function saveCase() {
    if (!caseDraft) return;
    void run(async (signal) => {
      const created = await createCase(caseDraft, signal);
      await onCreated(created, signal);
      setCaseDraft(null);
      setDescription('');
      setExternalNumber('');
      setExternalAuthority('');
    });
  }
  return (
    <section className="panel" aria-labelledby="new-case-heading">
      <h3 id="new-case-heading">Crear expediente</h3>
      <p>
        Cliente principal seleccionado: <strong>{client.name}</strong>.
      </p>
      <form onSubmit={reviewCase}>
        <fieldset disabled={busy || caseDraft !== null}>
          <legend>Datos del asunto</legend>
          <p>
            <label htmlFor="case-description">Descripción</label>
            <textarea
              id="case-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              required
              rows={4}
            />
          </p>
          <p>
            <label htmlFor="case-external-number">
              Número externo (opcional)
            </label>
            <input
              id="case-external-number"
              value={externalNumber}
              onChange={(event) => setExternalNumber(event.target.value)}
              maxLength={100}
            />
          </p>
          <p>
            <label htmlFor="case-authority">
              Autoridad del número externo (opcional)
            </label>
            <input
              id="case-authority"
              value={externalAuthority}
              onChange={(event) => setExternalAuthority(event.target.value)}
              maxLength={512}
            />
          </p>
          <p>
            El folio interno se genera al guardar. El estado inicial será NUEVO;
            la asignación de abogado se realiza por separado.
          </p>
          <button type="submit">Revisar datos del expediente</button>
        </fieldset>
      </form>
      {caseDraft && (
        <div className="review">
          <h4>Confirmar apertura</h4>
          <p>Cliente: {client.name}</p>
          <p>{caseDraft.description}</p>
          {caseDraft.externalNumber && (
            <p>
              Número externo: {caseDraft.externalNumber} · Autoridad:{' '}
              {caseDraft.externalAuthority}
            </p>
          )}
          <p className="actions">
            <button type="button" disabled={busy} onClick={saveCase}>
              Confirmar creación de expediente
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={busy}
              onClick={() => setCaseDraft(null)}
            >
              Editar datos del expediente
            </button>
          </p>
          <p>
            Si la respuesta se interrumpe, vuelve a confirmar conservando estos
            datos.
          </p>
        </div>
      )}
    </section>
  );
}
