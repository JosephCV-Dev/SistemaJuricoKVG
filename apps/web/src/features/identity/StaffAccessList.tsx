import { useState } from 'react';
import type { StaffAccess } from '@kvg/contracts';
import { documentTimestamp } from '../documents/document-format';

export function StaffAccessList({
  accesses,
  busy,
  onRevoke,
}: {
  accesses: StaffAccess[];
  busy: boolean;
  onRevoke: (id: string, reason: string) => void;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  return (
    <section aria-label="Concesiones vigentes">
      <h5>Concesiones vigentes</h5>
      {!accesses.length && <p>No hay concesiones vigentes.</p>}
      <ul>
        {accesses.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.caseFolio}</strong> · {entry.name}
            <p>
              {entry.permissions.length
                ? entry.permissions.join(', ')
                : 'Sin permisos efectivos'}{' '}
              ·{' '}
              {entry.expiresAt
                ? documentTimestamp(entry.expiresAt)
                : 'Sin vencimiento'}
            </p>
            {revoking === entry.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (reason.trim()) onRevoke(entry.id, reason.trim());
                }}
              >
                <fieldset disabled={busy}>
                  <legend>Revocar concesión</legend>
                  <label htmlFor={`access-reason-${entry.id}`}>
                    Motivo de la revocación
                  </label>
                  <textarea
                    id={`access-reason-${entry.id}`}
                    required
                    maxLength={2000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <div className="actions">
                    <button type="submit" disabled={!reason.trim()}>
                      Confirmar revocación
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setRevoking(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </fieldset>
              </form>
            ) : (
              <button
                type="button"
                className="button-secondary"
                disabled={busy}
                onClick={() => {
                  setRevoking(entry.id);
                  setReason('');
                }}
              >
                Revocar acceso
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
