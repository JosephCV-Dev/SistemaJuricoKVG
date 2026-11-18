import { useState } from 'react';
import type { StaffCapability, StaffMatrix, StaffRole } from '@kvg/contracts';
import type { RunDocumentAction } from '../documents/DocumentDetails';
import { changeStaffCapability, staffMatrix } from './staff-api';
import { roleLabels, roleOptions } from './staff-labels';

export function StaffMatrixPanel({
  busy,
  run,
  onNotice,
}: {
  busy: boolean;
  run: RunDocumentAction;
  onNotice: (text: string) => void;
}) {
  const [role, setRole] = useState<StaffRole>('SECRETARIA');
  const [matrix, setMatrix] = useState<StaffMatrix | null>(null);
  const [selected, setSelected] = useState<StaffCapability | null>(null);
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState('');
  function load(next: StaffRole, offset: number) {
    setRole(next);
    setSelected(null);
    void run(async (signal) =>
      setMatrix(await staffMatrix(next, offset, signal)),
    );
  }

  return (
    <section className="panel" aria-label="Matriz de permisos">
      <h2>Matriz de permisos</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          load(role, 0);
        }}
      >
        <fieldset disabled={busy}>
          <legend>Consultar permisos por rol</legend>
          <label htmlFor="matrix-role">Rol de la matriz</label>
          <select
            id="matrix-role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as StaffRole);
              setMatrix(null);
              setSelected(null);
            }}
          >
            {roleOptions.map((item) => (
              <option key={item} value={item}>
                {roleLabels[item]}
              </option>
            ))}
          </select>
          <button type="submit">Consultar permisos</button>
        </fieldset>
      </form>
      {matrix && (
        <>
          {!matrix.canEdit && (
            <p>
              Para cambiar la matriz se requiere la facultad jurídica del
              despacho además del permiso de gestión.
            </p>
          )}
          {!matrix.items.length && <p>No hay permisos en esta página.</p>}
          {matrix.items.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Permiso</th>
                    <th>Alcance</th>
                    <th>Estado</th>
                    {matrix.canEdit && <th>Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {matrix.items.map((item) => (
                    <tr key={item.permission + ':' + item.context}>
                      <td>{item.permission}</td>
                      <td>{item.context}</td>
                      <td>{item.active ? 'Activo' : 'Inactivo'}</td>
                      {matrix.canEdit && (
                        <td>
                          <button
                            type="button"
                            className="button-secondary"
                            disabled={busy}
                            onClick={() => {
                              setReason('');
                              setApproval('');
                              setSelected(item);
                            }}
                          >
                            {item.active
                              ? 'Desactivar permiso'
                              : 'Restablecer permiso'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(matrix.hasMore || matrix.offset > 0) && (
            <div className="actions">
              <button
                type="button"
                className="button-secondary"
                disabled={busy || matrix.offset === 0}
                onClick={() =>
                  load(role, Math.max(0, matrix.offset - matrix.limit))
                }
              >
                Página anterior
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={busy || !matrix.hasMore}
                onClick={() => load(role, matrix.offset + matrix.limit)}
              >
                Página siguiente
              </button>
            </div>
          )}
        </>
      )}
      {matrix && selected && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim() || !approval.trim()) return;
            void run(async (signal) => {
              await changeStaffCapability(
                {
                  ...selected,
                  active: !selected.active,
                  reason: reason.trim(),
                  approval: approval.trim(),
                },
                signal,
              );
              setSelected(null);
              setMatrix(
                await staffMatrix(selected.role, matrix.offset, signal),
              );
              onNotice('Permiso actualizado.');
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>Confirmar cambio de permiso</legend>
            <p>
              {roleLabels[selected.role]} · {selected.permission} ·{' '}
              {selected.context}
            </p>
            <p>
              <label htmlFor="matrix-reason">Motivo del cambio</label>
              <textarea
                id="matrix-reason"
                required
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </p>
            <p>
              <label htmlFor="matrix-approval">
                Referencia de autorización jurídica
              </label>
              <input
                id="matrix-approval"
                required
                maxLength={512}
                value={approval}
                onChange={(event) => setApproval(event.target.value)}
              />
            </p>
            <div className="actions">
              <button
                type="submit"
                disabled={!reason.trim() || !approval.trim()}
              >
                Confirmar cambio
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setSelected(null)}
              >
                Cancelar
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
