import { useState } from 'react';
import type { CaseStaffAccess } from '@kvg/contracts';
import type { RunDocumentAction } from '../documents/DocumentDetails';
import { StaffAccessList } from './StaffAccessList';
import {
  caseStaffAccess,
  grantStaffAccess,
  revokeStaffAccess,
} from './staff-api';

export function CaseStaffAccessPanel({
  caseId,
  busy,
  run,
  onNotice,
}: {
  caseId: string;
  busy: boolean;
  run: RunDocumentAction;
  onNotice: (message: string) => void;
}) {
  const [data, setData] = useState<CaseStaffAccess | null>(null);
  const [email, setEmail] = useState('');
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState('');
  const [expiry, setExpiry] = useState('');

  function load(email: string) {
    void run(async (signal) => {
      setSelected([]);
      setData(await caseStaffAccess(caseId, email, signal));
      setSearched(Boolean(email));
    });
  }

  return (
    <section className="record-detail" aria-labelledby="case-access-heading">
      <h4 id="case-access-heading">Accesos explícitos del expediente</h4>
      {!data ? (
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => load('')}
        >
          Gestionar accesos
        </button>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim()) load(email.trim());
            }}
          >
            <fieldset disabled={busy}>
              <legend>Buscar destinatario autorizado</legend>
              <label htmlFor="case-access-email">Correo de la persona</label>
              <input
                id="case-access-email"
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button type="submit">Buscar persona</button>
            </fieldset>
          </form>
          {searched && (!data.candidate || !data.permissions.length) && (
            <p>No hay un destinatario elegible con ese correo.</p>
          )}
          {data.candidate && data.permissions.length > 0 && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const userId = data.candidate?.id;
                if (
                  !userId ||
                  !selected.length ||
                  !reason.trim() ||
                  !approval.trim()
                )
                  return;
                void run(async (signal) => {
                  await grantStaffAccess(
                    caseId,
                    {
                      userId,
                      permissions: selected,
                      reason: reason.trim(),
                      approval: approval.trim(),
                      ...(expiry
                        ? { expiresAt: new Date(expiry).toISOString() }
                        : {}),
                    },
                    signal,
                  );
                  setData(await caseStaffAccess(caseId, '', signal));
                  setSearched(false);
                  setReason('');
                  setApproval('');
                  setExpiry('');
                  setEmail('');
                  onNotice('Acceso explícito concedido.');
                });
              }}
            >
              <fieldset disabled={busy}>
                <legend>Acceso para {data.candidate.name}</legend>
                <div>
                  <p>Permisos en este expediente</p>
                  {data.permissions.map((permission) => (
                    <label key={permission}>
                      <input
                        type="checkbox"
                        checked={selected.includes(permission)}
                        onChange={(event) => {
                          const include = event.target.checked;
                          setSelected((items) =>
                            include
                              ? [...items, permission]
                              : items.filter((item) => item !== permission),
                          );
                        }}
                      />{' '}
                      {permission}
                    </label>
                  ))}
                </div>
                <p>
                  <label htmlFor="case-access-reason">Motivo del acceso</label>
                  <textarea
                    id="case-access-reason"
                    value={reason}
                    maxLength={2000}
                    required
                    onChange={(event) => setReason(event.target.value)}
                  />
                </p>
                <p>
                  <label htmlFor="case-access-approval">
                    Referencia de autorización
                  </label>
                  <input
                    id="case-access-approval"
                    value={approval}
                    maxLength={512}
                    required
                    onChange={(event) => setApproval(event.target.value)}
                  />
                </p>
                <p>
                  <label htmlFor="case-access-expiry">
                    Vencimiento opcional en la hora de tu dispositivo
                  </label>
                  <input
                    id="case-access-expiry"
                    type="datetime-local"
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                  />
                </p>
                <button
                  type="submit"
                  disabled={
                    !selected.length || !reason.trim() || !approval.trim()
                  }
                >
                  Conceder acceso
                </button>
              </fieldset>
            </form>
          )}
          <StaffAccessList
            accesses={data.accesses}
            busy={busy}
            onRevoke={(id, reason) =>
              void run(async (signal) => {
                await revokeStaffAccess(id, reason, signal);
                setData(await caseStaffAccess(caseId, '', signal));
                setSearched(false);
                onNotice('Acceso revocado.');
              })
            }
          />
        </>
      )}
    </section>
  );
}
