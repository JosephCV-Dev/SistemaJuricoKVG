import type { AuthState, MfaEnrollmentResponse } from '@kvg/contracts';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AuthRequestError,
  enrollMfa,
  getSession,
  login,
  logout,
  refreshSession,
  verifyMfa,
} from './identity-api';
import { MfaQrCode } from './MfaQrCode';

type PendingOperation =
  'session' | 'login' | 'enroll' | 'verify' | 'refresh' | 'logout';

const pendingMessages: Record<PendingOperation, string> = {
  session: 'Comprobando sesión…',
  login: 'Comprobando credenciales…',
  enroll: 'Preparando la configuración de autenticación…',
  verify: 'Verificando código…',
  refresh: 'Actualizando sesión…',
  logout: 'Cerrando sesión…',
};

export function IdentitySection() {
  const [auth, setAuth] = useState<AuthState>({ status: 'anonymous' });
  const [pending, setPending] = useState<PendingOperation | null>('session');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [selectedFactorId, setSelectedFactorId] = useState('');
  const [enrollment, setEnrollment] = useState<MfaEnrollmentResponse | null>(
    null,
  );
  const currentRequest = useRef<AbortController | null>(null);

  function clearSensitiveFields() {
    setPassword('');
    setCode('');
    setEnrollment(null);
    setSelectedFactorId('');
  }

  function applyAuth(next: AuthState) {
    setAuth(next);
    clearSensitiveFields();
  }

  async function perform(
    operation: PendingOperation,
    action: (signal: AbortSignal) => Promise<void>,
  ) {
    currentRequest.current?.abort();
    const controller = new AbortController();
    currentRequest.current = controller;
    setPending(operation);
    setError(null);
    setNotice(null);

    try {
      await action(controller.signal);
    } catch (failure: unknown) {
      if (!controller.signal.aborted) {
        if (failure instanceof AuthRequestError && failure.status === 401) {
          applyAuth({ status: 'anonymous' });
        }

        setError(
          failure instanceof Error
            ? failure.message
            : 'No fue posible completar la operación de acceso.',
        );
      }
    } finally {
      if (currentRequest.current === controller) {
        currentRequest.current = null;
        setPending(null);
      }
    }
  }

  useEffect(() => {
    void perform('session', async (signal) => {
      const next = await getSession(signal);
      if (!signal.aborted) applyAuth(next);
    });

    return () => {
      currentRequest.current?.abort();
      currentRequest.current = null;
    };
    // La sesión se carga al montar; las acciones posteriores tienen sus propios controles.
  }, []);

  const busy = pending !== null;
  const factorId =
    enrollment?.factorId ??
    (auth.status === 'mfa_required'
      ? selectedFactorId || auth.factors[0]?.id || ''
      : '');

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const credentials = { email: email.trim(), password };
    clearSensitiveFields();

    void perform('login', async (signal) => {
      const next = await login(credentials, signal);
      if (!signal.aborted) applyAuth(next);
    });
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !factorId || !/^\d{6}$/.test(code)) return;
    const verification = { factorId, code };
    setCode('');

    void perform('verify', async (signal) => {
      const next = await verifyMfa(verification, signal);
      if (!signal.aborted) applyAuth(next);
    });
  }

  function startEnrollment() {
    if (busy) return;
    setCode('');
    setEnrollment(null);

    void perform('enroll', async (signal) => {
      const next = await enrollMfa(signal);
      if (!signal.aborted) setEnrollment(next);
    });
  }

  function updateSession() {
    if (busy) return;

    void perform('refresh', async (signal) => {
      const next = await refreshSession(signal);
      if (!signal.aborted) {
        applyAuth(next);
        if (next.status === 'authenticated') setNotice('Sesión actualizada.');
      }
    });
  }

  function closeSession() {
    if (busy) return;
    clearSensitiveFields();

    void perform('logout', async (signal) => {
      await logout(signal);
      if (!signal.aborted) {
        applyAuth({ status: 'anonymous' });
        setNotice('Sesión cerrada.');
      }
    });
  }

  return (
    <section
      className="panel"
      aria-labelledby="identity-heading"
      aria-busy={busy}
    >
      <h2 id="identity-heading">Acceso al sistema</h2>
      <div role="status" aria-live="polite" aria-atomic="true">
        {pending && <p>{pendingMessages[pending]}</p>}
        {notice && <p>{notice}</p>}
      </div>
      {error && <p role="alert">{error}</p>}

      {auth.status === 'anonymous' && pending !== 'session' && (
        <form onSubmit={submitLogin}>
          <p>Ingresa con la cuenta que te proporcionó el despacho.</p>
          <fieldset disabled={busy}>
            <legend>Iniciar sesión</legend>
            <p>
              <label htmlFor="login-email">Correo electrónico</label>{' '}
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                required
              />
            </p>
            <p>
              <label htmlFor="login-password">Contraseña</label>{' '}
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={128}
                required
              />
            </p>
            <button type="submit">Iniciar sesión</button>
          </fieldset>
        </form>
      )}

      {auth.status === 'mfa_required' && (
        <>
          <h3>Verificación en dos pasos</h3>
          {auth.enrollmentRequired && !enrollment && (
            <>
              <p>
                Configura una aplicación de autenticación para proteger tu
                cuenta.
              </p>
              <button type="button" onClick={startEnrollment} disabled={busy}>
                Configurar aplicación de autenticación
              </button>
            </>
          )}

          {enrollment && (
            <div>
              <p>Escanea este código con tu aplicación de autenticación.</p>
              <MfaQrCode qrCode={enrollment.qrCode} />
              <p>
                También puedes introducir esta clave manual:{' '}
                <code>{enrollment.secret}</code>
              </p>
              <p>
                No compartas esta clave. Se ocultará al completar la
                verificación.
              </p>
            </div>
          )}

          {factorId && (
            <form onSubmit={submitCode}>
              <fieldset disabled={busy}>
                <legend>Código de tu aplicación de autenticación</legend>
                {!enrollment && auth.factors.length > 1 && (
                  <p>
                    <label htmlFor="mfa-factor">Aplicación registrada</label>{' '}
                    <select
                      id="mfa-factor"
                      value={factorId}
                      onChange={(event) => {
                        setSelectedFactorId(event.target.value);
                        setCode('');
                      }}
                    >
                      {auth.factors.map((factor, index) => (
                        <option key={factor.id} value={factor.id}>
                          {factor.friendlyName || `Aplicación ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </p>
                )}
                <p>
                  <label htmlFor="mfa-code">Código de seis dígitos</label>{' '}
                  <input
                    id="mfa-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    required
                  />
                </p>
                <button type="submit">Verificar código</button>
              </fieldset>
            </form>
          )}

          <p>
            <button
              className="button-secondary"
              type="button"
              onClick={closeSession}
              disabled={busy}
            >
              Cancelar y cerrar sesión
            </button>
          </p>
        </>
      )}

      {auth.status === 'authenticated' && (
        <>
          <p>Sesión iniciada: {auth.user.name}.</p>
          <p>Roles: {auth.user.roles.join(', ') || 'Sin roles asignados'}.</p>
          <p>
            Vigencia máxima (hora de Mérida):{' '}
            <time dateTime={auth.expiresAt}>
              {new Intl.DateTimeFormat('es-MX', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'America/Merida',
              }).format(new Date(auth.expiresAt))}
            </time>
            .
          </p>
          <p>Inactividad máxima: {auth.idleTimeoutSeconds} segundos.</p>
          <p className="actions">
            <button type="button" onClick={updateSession} disabled={busy}>
              Actualizar sesión
            </button>{' '}
            <button
              className="button-secondary"
              type="button"
              onClick={closeSession}
              disabled={busy}
            >
              Cerrar sesión
            </button>
          </p>
        </>
      )}
    </section>
  );
}
