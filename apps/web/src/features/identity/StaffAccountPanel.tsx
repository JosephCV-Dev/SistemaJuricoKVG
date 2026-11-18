import { useState } from 'react';
import type { StaffDetail, StaffRole } from '@kvg/contracts';
import type { RunDocumentAction } from '../documents/DocumentDetails';
import { StaffAccessList } from './StaffAccessList';
import {
  blockStaffAuth,
  changeStaffRole,
  deactivateStaff,
  editStaff,
  revokeStaffAccess,
  sendStaffInvitation,
} from './staff-api';
import { roleLabels, roleOptions, statusLabels } from './staff-labels';

type Action = 'edit' | 'deactivate' | 'grant' | 'revoke';
const actionLabels: Record<Action, string> = {
  edit: 'Editar nombre',
  deactivate: 'Desactivar usuario',
  grant: 'Asignar rol',
  revoke: 'Retirar rol',
};
function blockMessage(blocked: boolean | null) {
  if (blocked === false)
    return 'Cuenta desactivada en KVG. Queda pendiente el bloqueo en Supabase Auth.';
  if (blocked === true)
    return 'Cuenta desactivada y bloqueada en Supabase Auth.';
  return 'Cuenta desactivada.';
}

export function StaffAccountPanel({
  detail,
  currentUserId,
  canManage,
  canPermissions,
  busy,
  run,
  onChanged,
  onNotice,
}: {
  detail: StaffDetail;
  currentUserId: string;
  canManage: boolean;
  canPermissions: boolean;
  busy: boolean;
  run: RunDocumentAction;
  onChanged: (signal: AbortSignal, notice: string) => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState(detail.name);
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState('');
  const [role, setRole] = useState<StaffRole | ''>('');
  const roles =
    action === 'revoke'
      ? detail.roles
      : roleOptions.filter((item) => !detail.roles.includes(item));
  const roleAction = action === 'grant' || action === 'revoke';
  const disabled = detail.status === 'DESACTIVADO';

  function open(next: Action) {
    setAction(next);
    setReason('');
    setApproval('');
    setRole('');
    setName(detail.name);
  }

  return (
    <section className="record-detail" aria-label="Ficha del usuario">
      <h4>{detail.name}</h4>
      <dl>
        <dt>Correo</dt>
        <dd>{detail.email}</dd>
        <dt>Estado de cuenta</dt>
        <dd>{statusLabels[detail.status]}</dd>
        <dt>Roles</dt>
        <dd>
          {detail.roles.map((item) => roleLabels[item]).join(', ') ||
            'Sin roles asignados'}
        </dd>
      </dl>
      {detail.requiresReassignment && (
        <p>
          Reasigna sus expedientes antes de desactivar la cuenta o retirar el
          rol jurídico.
        </p>
      )}
      {!action && (
        <div className="actions">
          {canManage && !disabled && (
            <>
              <button
                type="button"
                className="button-secondary"
                disabled={busy}
                onClick={() => open('edit')}
              >
                Editar nombre
              </button>
              {!detail.requiresReassignment && (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => open('deactivate')}
                >
                  Desactivar usuario
                </button>
              )}
            </>
          )}
          {canManage && detail.status === 'INVITADO' && (
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() =>
                void run(async (signal) => {
                  const result = await sendStaffInvitation(detail.id, signal);
                  if (result.accepted)
                    onNotice('Supabase aceptó el envío de la invitación.');
                })
              }
            >
              Enviar invitación por correo
            </button>
          )}
          {canManage && disabled && (
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() =>
                void run(async (signal) => {
                  const result = await blockStaffAuth(detail.id, signal);
                  onNotice(blockMessage(result.providerBlocked));
                })
              }
            >
              Comprobar bloqueo en Supabase
            </button>
          )}
          {canPermissions && detail.id !== currentUserId && !disabled && (
            <>
              {detail.roles.length < roleOptions.length && (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => open('grant')}
                >
                  Asignar rol
                </button>
              )}
              {detail.roles.length > 0 && (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => open('revoke')}
                >
                  Retirar rol
                </button>
              )}
            </>
          )}
        </div>
      )}
      {action && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = { revision: detail.revision, reason: reason.trim() };
            if (!input.reason) return;
            void run(async (signal) => {
              let message: string;
              if (action === 'edit') {
                await editStaff(
                  detail.id,
                  { ...input, name: name.trim() },
                  signal,
                );
                message = 'Usuario actualizado.';
              } else if (action === 'deactivate') {
                const result = await deactivateStaff(detail.id, input, signal);
                message = blockMessage(result.providerBlocked);
              } else {
                if (!role || !approval.trim()) return;
                await changeStaffRole(
                  detail.id,
                  { ...input, action, role, approval: approval.trim() },
                  signal,
                );
                message =
                  action === 'grant' ? 'Rol asignado.' : 'Rol retirado.';
              }
              setAction(null);
              await onChanged(signal, message);
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>{actionLabels[action]}</legend>
            {action === 'deactivate' && (
              <p>
                Se cerrarán las sesiones operativas de la cuenta. Sus registros
                y autoría se conservan.
              </p>
            )}
            {action === 'edit' && (
              <p>
                <label htmlFor="staff-edit-name">Nombre</label>
                <input
                  id="staff-edit-name"
                  value={name}
                  required
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                />
              </p>
            )}
            {roleAction && (
              <>
                <p>
                  <label htmlFor="staff-role">Rol</label>
                  <select
                    id="staff-role"
                    value={role}
                    required
                    onChange={(event) =>
                      setRole(event.target.value as StaffRole | '')
                    }
                  >
                    <option value="">Selecciona un rol</option>
                    {roles.map((item) => (
                      <option
                        key={item}
                        value={item}
                        disabled={
                          action === 'revoke' &&
                          item === 'ABOGADO' &&
                          detail.requiresReassignment
                        }
                      >
                        {roleLabels[item]}
                      </option>
                    ))}
                  </select>
                </p>
                <p>
                  <label htmlFor="staff-approval">
                    Referencia de autorización
                  </label>
                  <input
                    id="staff-approval"
                    value={approval}
                    required
                    maxLength={512}
                    onChange={(event) => setApproval(event.target.value)}
                  />
                </p>
              </>
            )}
            <p>
              <label htmlFor="staff-change-reason">Motivo</label>
              <textarea
                id="staff-change-reason"
                value={reason}
                maxLength={2000}
                required
                onChange={(event) => setReason(event.target.value)}
              />
            </p>
            <div className="actions">
              <button
                type="submit"
                disabled={
                  !reason.trim() || (roleAction && (!role || !approval.trim()))
                }
              >
                Confirmar
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setAction(null)}
              >
                Cancelar
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {canPermissions && (
        <StaffAccessList
          accesses={detail.accesses}
          busy={busy}
          onRevoke={(id, reason) =>
            void run(async (signal) => {
              await revokeStaffAccess(id, reason, signal);
              await onChanged(signal, 'Acceso explícito revocado.');
            })
          }
        />
      )}
    </section>
  );
}
