import { Icon } from '../../shared/ui/Icon';
import { useState } from 'react';
import { mutate, readJson } from '../../shared/api/session-http';

export function AcceptInvitation({
  tokenHash,
}: {
  tokenHash: string | undefined;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  return (
    <div className="access-layout">
      <main className="access-main" id="main-content">
        <div className="access-brand">
          <img
            src="/kvg-logo.jpg"
            alt="KVG Asesores Corporativos"
            width="1489"
            height="1600"
          />
        </div>
        <section className="panel">
          <h1 className="visual-heading">
            <Icon name="shield" />
            <span>Activar cuenta KVG</span>
          </h1>
          {done ? (
            <p role="status">
              Contraseña guardada. Inicia sesión y configura tu segundo factor
              para activar la cuenta.
            </p>
          ) : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setError('');
                if (password !== confirmation) {
                  setError('Las contraseñas deben coincidir.');
                  return;
                }
                setBusy(true);
                try {
                  const response = await mutate(
                    '/api/v1/auth/invitation/complete',
                    {
                      ...(tokenHash ? { tokenHash } : {}),
                      password,
                    },
                    AbortSignal.timeout(30000),
                  );
                  if (response.status !== 204) await readJson(response);
                  setPassword('');
                  setConfirmation('');
                  setDone(true);
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : 'No se pudo activar la cuenta.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy}>
                <legend>Define tu contraseña</legend>
                <label htmlFor="invite-password">Nueva contraseña</label>
                <input
                  id="invite-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <label htmlFor="invite-password-repeat">
                  Confirma la contraseña
                </label>
                <input
                  id="invite-password-repeat"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                <button type="submit">
                  {busy ? 'Guardando…' : 'Guardar contraseña'}
                </button>
              </fieldset>
            </form>
          )}
          {error && <p role="alert">{error}</p>}
          <p>
            <a href="/">Ir al inicio de sesión</a>
          </p>
        </section>
      </main>
    </div>
  );
}
