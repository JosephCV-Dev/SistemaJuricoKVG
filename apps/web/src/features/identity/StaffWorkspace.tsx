import { useEffect, useRef, useState } from 'react';
import type { RecordPage, StaffAccount, StaffDetail } from '@kvg/contracts';
import type { RunDocumentAction } from '../documents/DocumentDetails';
import { StaffAccountPanel } from './StaffAccountPanel';
import { StaffMatrixPanel } from './StaffMatrixPanel';
import { getStaff, listStaff, reserveStaffInvitation } from './staff-api';
import { statusLabels } from './staff-labels';

export function StaffWorkspace({
  currentUserId,
  canManage,
  canPermissions,
  busy,
  run,
  onNotice,
}: {
  currentUserId: string;
  canManage: boolean;
  canPermissions: boolean;
  busy: boolean;
  run: RunDocumentAction;
  onNotice: (text: string) => void;
}) {
  const [page, setPage] = useState<RecordPage<StaffAccount> | null>(null);
  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'list' | 'invite' | 'matrix'>('list');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const draft = useRef<{ id: string; key: string } | null>(null);
  const loaded = useRef(false);

  function load(search: string, offset: number) {
    void run(async (signal) => {
      setDetail(null);
      setPage(await listStaff(search, offset, signal));
      setQuery(search);
    });
  }
  useEffect(() => {
    if (!busy && !loaded.current) {
      loaded.current = true;
      load('', 0);
    }
  }, [busy]);

  return (
    <>
      <nav className="actions" aria-label="Administración de personal">
        <button
          type="button"
          className="button-secondary"
          aria-pressed={mode === 'list'}
          disabled={busy}
          onClick={() => setMode('list')}
        >
          Directorio
        </button>
        {canManage && (
          <button
            type="button"
            className="button-secondary"
            aria-pressed={mode === 'invite'}
            disabled={busy}
            onClick={() => {
              setDetail(null);
              setMode('invite');
            }}
          >
            Nueva invitación
          </button>
        )}
        {canPermissions && (
          <button
            type="button"
            className="button-secondary"
            aria-pressed={mode === 'matrix'}
            disabled={busy}
            onClick={() => setMode('matrix')}
          >
            Matriz de permisos
          </button>
        )}
      </nav>
      {mode === 'matrix' && canPermissions && (
        <StaffMatrixPanel busy={busy} run={run} onNotice={onNotice} />
      )}
      {mode === 'invite' && canManage && (
        <section className="panel" aria-label="Nueva invitación">
          <h2>Nueva invitación</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const input = {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                reason: reason.trim(),
              };
              if (!input.name || !input.email || !input.reason) return;
              const key = JSON.stringify(input);
              if (draft.current?.key !== key)
                draft.current = { id: crypto.randomUUID(), key };
              const requestId = draft.current.id;
              void run(async (signal) => {
                const saved = await reserveStaffInvitation(
                  { ...input, requestId },
                  signal,
                );
                draft.current = null;
                setName('');
                setEmail('');
                setReason('');
                setDetail(await getStaff(saved.id, signal));
                setPage(await listStaff(query, 0, signal));
                setMode('list');
                onNotice(
                  'Invitación preparada. Desde la ficha puedes asignar un rol y enviar el correo.',
                );
              });
            }}
          >
            <fieldset disabled={busy}>
              <legend>Datos de la persona invitada</legend>
              <p>
                <label htmlFor="staff-new-name">Nombre</label>
                <input
                  id="staff-new-name"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </p>
              <p>
                <label htmlFor="staff-new-email">Correo del destinatario</label>
                <input
                  id="staff-new-email"
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </p>
              <p>
                <label htmlFor="staff-new-reason">Motivo del alta</label>
                <textarea
                  id="staff-new-reason"
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </p>
              <button
                type="submit"
                disabled={!name.trim() || !email.trim() || !reason.trim()}
              >
                Preparar invitación
              </button>
            </fieldset>
          </form>
        </section>
      )}
      {mode === 'list' && (
        <section className="panel" aria-label="Directorio de usuarios">
          <h2>Directorio de usuarios</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              load(filter.trim(), 0);
            }}
          >
            <fieldset disabled={busy}>
              <legend>Buscar en el directorio</legend>
              <label htmlFor="staff-filter">Nombre o correo</label>
              <input
                id="staff-filter"
                maxLength={200}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <button type="submit">Buscar usuarios</button>
            </fieldset>
          </form>
          {page?.items.length === 0 && <p>No se encontraron usuarios.</p>}
          {page && page.items.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          disabled={busy}
                          onClick={() =>
                            void run(async (signal) =>
                              setDetail(await getStaff(item.id, signal)),
                            )
                          }
                        >
                          {item.name}
                        </button>
                      </td>
                      <td>{item.email}</td>
                      <td>{statusLabels[item.status]}</td>
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
                onClick={() =>
                  load(query, Math.max(0, page.offset - page.limit))
                }
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
          {detail && (
            <StaffAccountPanel
              key={detail.id}
              detail={detail}
              currentUserId={currentUserId}
              canManage={canManage}
              canPermissions={canPermissions}
              busy={busy}
              run={run}
              onNotice={onNotice}
              onChanged={async (signal, notice) => {
                setDetail(await getStaff(detail.id, signal));
                setPage(await listStaff(query, page?.offset ?? 0, signal));
                onNotice(notice);
              }}
            />
          )}
        </section>
      )}
    </>
  );
}
