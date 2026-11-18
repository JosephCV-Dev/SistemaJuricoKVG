import type { AuthState, SessionCapabilities } from '@kvg/contracts';
import { useState } from 'react';
import { IdentitySection } from '../features/identity/IdentitySection';
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
    <div className={authenticated ? 'app-layout' : 'access-layout'}>
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
