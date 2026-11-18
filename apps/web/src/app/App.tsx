import type { AuthState, SessionCapabilities } from '@kvg/contracts';
import { useState } from 'react';
import { IdentitySection } from '../features/identity/IdentitySection';
import GhostFibers from '../features/identity/GhostFibers';
import { RecordsWorkspace } from '../features/records/RecordsWorkspace';
import { Icon } from '../shared/ui/Icon';
import { Sidebar } from './Sidebar';
import { viewIcons, viewTitles } from '../shared/navigation';
import type { WorkspaceView } from '../shared/navigation';

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'anonymous' });
  const [view, setView] = useState<WorkspaceView>('home');
  const [capabilities, setCapabilities] = useState<
    SessionCapabilities['capabilities']
  >([]);
  function changeAuth(next: AuthState) {
    if (
      next.status !== 'authenticated' ||
      auth.status !== 'authenticated' ||
      next.user.id !== auth.user.id
    ) {
      setView('home');
      setCapabilities([]);
    }
    setAuth(next);
  }
  function navigate(next: WorkspaceView) {
    setView(next);
    window.scrollTo(0, 0);
    requestAnimationFrame(() =>
      document.getElementById('page-heading')?.focus({ preventScroll: true }),
    );
  }
  const authenticated = auth.status === 'authenticated';
  return (
    <div
      className={authenticated ? 'app-layout' : 'access-layout login-preview'}
    >
      {!authenticated && (
        <GhostFibers
          className="login-ghost-fibers"
          aria-hidden="true"
          glowColor="#527fc4"
          secondaryColor="#aa476b"
          lineColor="#bfd1f4"
          gradient="along"
          layers={2}
          threads={48}
          speed={0.26}
          brightness={0.84}
          particles={0.15}
          mouseInteraction={false}
          pulseOnClick={false}
          intro={false}
          dpr={1}
        />
      )}
      <a className="skip-link" href="#main-content">
        Ir al contenido
      </a>
      {authenticated && (
        <Sidebar
          view={view}
          onNavigate={navigate}
          capabilities={capabilities}
          name={auth.user.name}
          roles={auth.user.roles}
        />
      )}
      <main
        id="main-content"
        tabIndex={-1}
        className={authenticated ? 'workspace-main' : 'access-main'}
      >
        {!authenticated && (
          <div className="access-brand">
            <svg
              className="login-logo-filter"
              width="0"
              height="0"
              aria-hidden="true"
            >
              <defs>
                <filter
                  id="kvg-login-ink"
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  colorInterpolationFilters="sRGB"
                >
                  <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" />
                  <feComponentTransfer result="ink-mask">
                    <feFuncA type="linear" slope="-1.35" intercept="1.31" />
                  </feComponentTransfer>
                  <feFlood floodColor="#e5a0b5" result="ink" />
                  <feComposite in="ink" in2="ink-mask" operator="in" />
                </filter>
              </defs>
            </svg>
            <img
              src="/kvg-logo.jpg"
              alt="KVG Asesores Corporativos"
              width="1489"
              height="1600"
            />
            <p>Gestión documental del despacho</p>
          </div>
        )}
        {authenticated && view !== 'case' && view !== 'client' && (
          <header className="page-header">
            <h1 id="page-heading" className="visual-heading" tabIndex={-1}>
              <Icon name={viewIcons[view]} />
              <span>{viewTitles[view]}</span>
            </h1>
            {view === 'home' && (
              <p className="sub">Bienvenido, {auth.user.name}.</p>
            )}
          </header>
        )}
        <div hidden={authenticated && view !== 'session'}>
          <IdentitySection auth={auth} onAuthChange={changeAuth} />
        </div>
        {authenticated && (
          <RecordsWorkspace
            key={auth.user.id}
            view={view}
            isLawyer={auth.user.roles.includes('ABOGADO')}
            currentUserId={auth.user.id}
            onNavigate={navigate}
            onCapabilities={setCapabilities}
            onSessionExpired={() => changeAuth({ status: 'anonymous' })}
          />
        )}
        {!authenticated && (
          <p className="access-footer">
            Acceso exclusivo para personal autorizado.
          </p>
        )}
      </main>
    </div>
  );
}
