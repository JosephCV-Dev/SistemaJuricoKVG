import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CaseDetail,
  CaseUpdateInput,
  CaseUpdateReason,
} from '@kvg/contracts';

const reasons: Record<CaseUpdateReason, string> = {
  CORREGIR_CAPTURA: 'Corregir un dato capturado',
  PRECISAR_DESCRIPCION: 'Precisar la descripción',
  ACTUALIZAR_REFERENCIA: 'Actualizar la referencia externa',
  OTRA_CORRECCION: 'Otra corrección de datos generales',
};

export function CaseEditor({
  caseDetail,
  busy,
  onSave,
  onCancel,
  onReload,
}: {
  caseDetail: CaseDetail;
  busy: boolean;
  onSave: (input: CaseUpdateInput) => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const [description, setDescription] = useState(caseDetail.description);
  const [number, setNumber] = useState(caseDetail.externalNumber ?? '');
  const [authority, setAuthority] = useState(
    caseDetail.externalAuthority ?? '',
  );
  const [reason, setReason] = useState<CaseUpdateReason | ''>('');
  const [error, setError] = useState('');
  const referenceChanged =
    number.trim() !== (caseDetail.externalNumber ?? '') ||
    authority.trim() !== (caseDetail.externalAuthority ?? '');
  const descriptionChanged = description.trim() !== caseDetail.description;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!reason || (!referenceChanged && !descriptionChanged)) return;
    if (
      referenceChanged &&
      Boolean(number.trim()) !== Boolean(authority.trim())
    ) {
      setError(
        'Completa el número externo y la autoridad, o deja ambos vacíos para quitar la referencia.',
      );
      return;
    }
    onSave({
      revision: caseDetail.revision,
      reason,
      ...(descriptionChanged ? { description: description.trim() } : {}),
      ...(referenceChanged
        ? {
            externalNumber: number.trim() || null,
            externalAuthority: authority.trim() || null,
          }
        : {}),
    });
  }

  return (
    <form className="record-detail" onSubmit={submit}>
      <h3>Editar expediente {caseDetail.folio}</h3>
      <p>Revisión {caseDetail.revision}</p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <legend>Datos generales</legend>
        <p>
          <label htmlFor="edit-case-description">Descripción</label>
          <textarea
            id="edit-case-description"
            value={description}
            required
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </p>
        <p>
          <label htmlFor="edit-case-external-number">Número externo</label>
          <input
            id="edit-case-external-number"
            value={number}
            maxLength={100}
            onChange={(event) => setNumber(event.target.value)}
          />
        </p>
        <p>
          <label htmlFor="edit-case-external-authority">
            Autoridad externa
          </label>
          <input
            id="edit-case-external-authority"
            value={authority}
            maxLength={512}
            onChange={(event) => setAuthority(event.target.value)}
          />
        </p>
        <p>
          <label htmlFor="edit-case-reason">Motivo del cambio</label>
          <select
            id="edit-case-reason"
            required
            value={reason}
            onChange={(event) =>
              setReason(event.target.value as CaseUpdateReason | '')
            }
          >
            <option value="">Selecciona un motivo</option>
            {Object.entries(reasons).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </p>
      </fieldset>
      <p className="actions">
        <button
          type="submit"
          disabled={busy || (!descriptionChanged && !referenceChanged)}
        >
          Confirmar cambios
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
          Descartar cambios y consultar datos vigentes
        </button>
      </p>
    </form>
  );
}
