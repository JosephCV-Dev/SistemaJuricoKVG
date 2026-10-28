import type { AuthState, HealthResponse } from '@kvg/contracts';
import { useEffect, useRef, useState } from 'react';
import { IdentitySection } from '../features/identity/IdentitySection';
import { getHealth } from '../shared/api/http-client';
import { RecordsWorkspace } from '../features/records/RecordsWorkspace';

type HealthState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; health: HealthResponse }
  | { status: 'error'; message: string };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'anonymous' });
  const [state, setState] = useState<HealthState>({ status: 'idle' });
  const currentRequest = useRef<AbortController | null>(null);

  useEffect(() => () => currentRequest.current?.abort(), []);

  async function checkApi() {
    currentRequest.current?.abort();
    const controller = new AbortController();
    currentRequest.current = controller;
    setState({ status: 'loading' });

    try {
      const health = await getHealth(controller.signal);

      if (!controller.signal.aborted) {
        setState({ status: 'success', health });
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        setState({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'No fue posible comunicarse con la API.',
        });
      }
    } finally {
      if (currentRequest.current === controller) {
        currentRequest.current = null;
      }
    }
  }

  return (
    <main>
      <header className="app-header">
        <h1>Sistema Jurídico KVG</h1>
      </header>

      <IdentitySection auth={auth} onAuthChange={setAuth} />
      {auth.status === 'authenticated' && (
        <RecordsWorkspace
          key={auth.user.id}
          onSessionExpired={() => setAuth({ status: 'anonymous' })}
        />
      )}

      <section className="panel" aria-labelledby="api-heading">
        <h2 id="api-heading">Comunicación con la API</h2>
        <button
          className="button-secondary"
          type="button"
          onClick={() => void checkApi()}
          disabled={state.status === 'loading'}
        >
          Comprobar API
        </button>
        <div role="status" aria-live="polite" aria-atomic="true">
          {state.status === 'idle' && (
            <p>La conexión aún no se ha comprobado.</p>
          )}
          {state.status === 'loading' && <p>Comprobando conexión…</p>}
          {state.status === 'success' && (
            <p>
              API disponible: {state.health.service}, versión{' '}
              {state.health.version}.
            </p>
          )}
        </div>
        {state.status === 'error' && (
          <p role="alert">No se pudo comprobar la API. {state.message}</p>
        )}
      </section>
    </main>
  );
}
