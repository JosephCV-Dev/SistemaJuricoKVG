import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { CaseAssignmentRole, CaseTeam } from '@kvg/contracts';
import { getCaseTeam, saveCaseAssignment } from './records-api';
import { showDate } from './record-format';

export type RunRecordAction = (
  action: (signal: AbortSignal) => Promise<void>,
) => Promise<void>;

export function CaseAssignmentPanel({
  id,
  reassign = false,
  busy,
  run,
  onSaved,
  onBack,
}: {
  id: string;
  reassign?: boolean;
  busy: boolean;
  run: RunRecordAction;
  onSaved: (signal: AbortSignal) => Promise<void>;
  onBack: () => void;
}) {
  const [team, setTeam] = useState<CaseTeam | null>(null);
  const [search, setSearch] = useState('');
  const [searched, setSearched] = useState('');
  const [lawyerId, setLawyer] = useState('');
  const [role, setRole] = useState<CaseAssignmentRole>('PRINCIPAL');
  const [reason, setReason] = useState('');
  const [approvalReference, setApprovalReference] = useState('');
  const [keepCollaborator, setKeepCollaborator] = useState(false);
  const initial = useRef(false);

  async function readTeam(query: string, offset: number, signal: AbortSignal) {
    const next = await getCaseTeam(id, reassign, query, offset, signal);
    setTeam(next);
    setSearched(query);
    setLawyer('');
    if (
      next.assignments.some((item) => item.role === 'PRINCIPAL' && !item.endsAt)
    )
      setRole('COLABORADOR');
  }

  useEffect(() => {
    if (!busy && !initial.current) {
      initial.current = true;
      void run((signal) => readTeam('', 0, signal));
    }
  }, [busy]);

  const now = Date.now();
  const current =
    team?.assignments.filter(
      (item) =>
        Date.parse(item.startsAt) <= now &&
        (!item.endsAt || Date.parse(item.endsAt) > now),
    ) ?? [];
  const principal = current.find((item) => item.role === 'PRINCIPAL');
  const eligible =
    team?.lawyers.items.filter((lawyer) =>
      reassign
        ? lawyer.id !== principal?.userId
        : !current.some((item) => item.userId === lawyer.id),
    ) ?? [];

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!team || !lawyerId || !reason.trim()) return;
    const fields = { revision: team.revision, lawyerId, reason: reason.trim() };
    const input = reassign
      ? {
          ...fields,
          approvalReference: approvalReference.trim(),
          keepCollaborator,
        }
      : { ...fields, role: principal ? ('COLABORADOR' as const) : role };
    void run(async (signal) => {
      await saveCaseAssignment(id, input, signal);
      await onSaved(signal);
    });
  }

  return (
    <section className="record-detail" aria-labelledby="case-team-heading">
      <h3 id="case-team-heading">
        {reassign ? 'Reasignar responsable' : 'Asignar abogado'}
        {team ? ` · ${team.folio}` : ''}
      </h3>
      {team && (
        <>
          <p>
            Principal vigente: {principal?.name ?? 'Sin responsable principal'}.
          </p>
          {current.some((item) => item.role === 'COLABORADOR') && (
            <p>
              Colaboradores:{' '}
              {current
                .filter((item) => item.role === 'COLABORADOR')
                .map((item) => item.name)
                .join(', ')}
              .
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run((signal) => readTeam(search.trim(), 0, signal));
            }}
          >
            <fieldset disabled={busy}>
              <legend>Buscar abogados activos</legend>
              <p>
                <label htmlFor="lawyer-search">Nombre del abogado</label>
                <input
                  id="lawyer-search"
                  value={search}
                  maxLength={200}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </p>
              <button type="submit">Buscar abogados</button>
            </fieldset>
          </form>
          <div className="actions">
            <button
              className="button-secondary"
              type="button"
              disabled={busy || team.lawyers.offset === 0}
              onClick={() =>
                void run((signal) =>
                  readTeam(
                    searched,
                    Math.max(0, team.lawyers.offset - team.lawyers.limit),
                    signal,
                  ),
                )
              }
            >
              Abogados anteriores
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={busy || !team.lawyers.hasMore}
              onClick={() =>
                void run((signal) =>
                  readTeam(
                    searched,
                    team.lawyers.offset + team.lawyers.limit,
                    signal,
                  ),
                )
              }
            >
              Abogados siguientes
            </button>
          </div>
          {!eligible.length && <p>No hay abogados elegibles en esta página.</p>}
          <form onSubmit={confirm}>
            <fieldset disabled={busy}>
              <legend>Datos de la asignación</legend>
              <p>
                <label htmlFor="case-lawyer">
                  {reassign ? 'Nuevo principal' : 'Abogado'}
                </label>
                <select
                  id="case-lawyer"
                  value={lawyerId}
                  required
                  onChange={(event) => setLawyer(event.target.value)}
                >
                  <option value="">Selecciona un abogado</option>
                  {eligible.map((lawyer) => (
                    <option key={lawyer.id} value={lawyer.id}>
                      {lawyer.name}
                    </option>
                  ))}
                </select>
              </p>
              {!reassign && (
                <p>
                  <label htmlFor="case-assignment-role">Función</label>
                  <select
                    id="case-assignment-role"
                    value={principal ? 'COLABORADOR' : role}
                    onChange={(event) =>
                      setRole(
                        event.target.value === 'PRINCIPAL'
                          ? 'PRINCIPAL'
                          : 'COLABORADOR',
                      )
                    }
                  >
                    <option value="PRINCIPAL" disabled={Boolean(principal)}>
                      Principal
                    </option>
                    <option value="COLABORADOR">Colaborador</option>
                  </select>
                </p>
              )}
              <p>
                <label htmlFor="case-assignment-reason">Motivo</label>
                <textarea
                  id="case-assignment-reason"
                  value={reason}
                  required
                  maxLength={2000}
                  onChange={(event) => setReason(event.target.value)}
                />
              </p>
              {reassign && (
                <>
                  <p>
                    <label htmlFor="case-reassignment-approval">
                      Referencia de autorización
                    </label>
                    <input
                      id="case-reassignment-approval"
                      value={approvalReference}
                      required
                      maxLength={128}
                      onChange={(event) =>
                        setApprovalReference(event.target.value)
                      }
                    />
                  </p>
                  <p>
                    <label>
                      <input
                        type="checkbox"
                        checked={keepCollaborator}
                        onChange={(event) =>
                          setKeepCollaborator(event.target.checked)
                        }
                      />{' '}
                      Mantener al principal saliente como colaborador
                    </label>
                  </p>
                </>
              )}
              <button type="submit" disabled={!lawyerId || !reason.trim()}>
                {reassign ? 'Confirmar reasignación' : 'Confirmar asignación'}
              </button>
            </fieldset>
          </form>
          {!reassign && team.assignments.length > 0 && (
            <details>
              <summary>Historial de asignaciones</summary>
              <ul>
                {team.assignments.map((item) => (
                  <li key={item.id}>
                    {item.name} ·{' '}
                    {item.role === 'PRINCIPAL' ? 'Principal' : 'Colaborador'} ·{' '}
                    {showDate(item.startsAt)}
                    {item.endsAt ? ` a ${showDate(item.endsAt)}` : ' · Vigente'}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <div className="actions">
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={() => void run((signal) => readTeam(searched, 0, signal))}
        >
          Actualizar equipo
        </button>
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={onBack}
        >
          Volver
        </button>
      </div>
    </section>
  );
}
