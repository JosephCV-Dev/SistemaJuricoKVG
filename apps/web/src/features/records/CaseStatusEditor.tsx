import { useState } from 'react';
import type { FormEvent } from 'react';
import type { CaseDetail, CaseStateChangeInput } from '@kvg/contracts';

export const statusLabel = {
  NUEVO: 'Nuevo',
  EN_PROCESO: 'En proceso',
  PENDIENTE: 'Pendiente',
  CONCLUIDO: 'Concluido',
  ARCHIVADO: 'Archivado',
};

export function CaseStatusEditor({
  detail,
  busy,
  onSave,
  onReload,
  onCancel,
}: {
  detail: CaseDetail;
  busy: boolean;
  onSave: (input: CaseStateChangeInput) => void;
  onReload: () => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState('');
  const transition = detail.transitions.find(
    (item) => item.status === selected,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !transition ||
      !reason.trim() ||
      (transition.requiresDecision && !approval.trim())
    )
      return;
    onSave({
      revision: detail.revision,
      status: transition.status,
      reason: reason.trim(),
      ...(transition.requiresDecision
        ? { approvalReference: approval.trim() }
        : {}),
    });
  }
  return (
    <form className="record-detail" onSubmit={submit}>
      <h3>Cambiar estado</h3>
      <p>Estado actual: {statusLabel[detail.status]}.</p>
      <fieldset disabled={busy}>
        <legend>Transición del expediente</legend>
        <p>
          <label htmlFor="case-next-state">Nuevo estado</label>
          <select
            id="case-next-state"
            required
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              setApproval('');
            }}
          >
            <option value="">Selecciona un estado</option>
            {detail.transitions.map((item) => (
              <option key={item.status} value={item.status}>
                {statusLabel[item.status]}
              </option>
            ))}
          </select>
        </p>
        {transition?.requiresDecision && (
          <p>
            <label htmlFor="case-state-approval">
              Referencia de autorización
            </label>
            <input
              id="case-state-approval"
              required
              maxLength={512}
              value={approval}
              onChange={(event) => setApproval(event.target.value)}
            />
          </p>
        )}
        <p>
          <label htmlFor="case-state-reason">Motivo del cambio</label>
          <textarea
            id="case-state-reason"
            required
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </p>
      </fieldset>
      <div className="actions">
        <button type="submit" disabled={busy || !transition || !reason.trim()}>
          Confirmar estado
        </button>
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={onReload}
        >
          Descartar cambios y consultar estado vigente
        </button>
      </div>
    </form>
  );
}
