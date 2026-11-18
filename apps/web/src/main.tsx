import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AcceptInvitation } from './features/identity/AcceptInvitation';
import './app/styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('No se encontró el elemento raíz de la aplicación.');
}

const isInvitation = window.location.pathname === '/activar-cuenta';
const invitationToken = isInvitation
  ? (new URLSearchParams(window.location.hash.slice(1)).get('invitacion') ??
    undefined)
  : undefined;
if (isInvitation && (window.location.hash || window.location.search))
  window.history.replaceState(null, '', '/activar-cuenta');

createRoot(root).render(
  <StrictMode>
    {isInvitation ? <AcceptInvitation tokenHash={invitationToken} /> : <App />}
  </StrictMode>,
);
