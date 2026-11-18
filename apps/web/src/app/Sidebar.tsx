import { useRef, useState } from 'react';
import type { SessionCapabilities } from '@kvg/contracts';
import { viewIcons, type WorkspaceView } from '../shared/navigation';
import { Icon } from '../shared/ui/Icon';

export function Sidebar({
  view,
  onNavigate,
  capabilities,
  name,
  roles,
}: {
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  capabilities: SessionCapabilities['capabilities'];
  name: string;
  roles: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const can = (permission: string) =>
    capabilities.some((item) => item.permission === permission);
  const link = (target: WorkspaceView, label: string, active: boolean) => (
    <button
      type="button"
      className="nav-link"
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        setExpanded(false);
        onNavigate(target);
      }}
    >
      <Icon name={viewIcons[target]} />
      {label}
    </button>
  );
  return (
    <aside
      className="sidebar"
      aria-label="Menú del sistema"
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          expanded &&
          toggle.current?.getClientRects().length
        ) {
          setExpanded(false);
          toggle.current.focus();
        }
      }}
    >
      <div className="brand">
        <img
          src="/kvg-logo.jpg"
          alt="KVG Asesores Corporativos"
          width="1489"
          height="1600"
        />
        <div>
          <strong>Despacho KVG</strong>
          <small>Gestión documental</small>
        </div>
      </div>
      <button
        ref={toggle}
        type="button"
        className="menu-toggle button-secondary"
        aria-expanded={expanded}
        aria-controls="workspace-navigation"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name={expanded ? 'close' : 'menu'} />
        {expanded ? 'Cerrar menú' : 'Abrir menú'}
      </button>
      <nav
        id="workspace-navigation"
        aria-label="Navegación principal"
        data-open={expanded}
      >
        {link('home', 'Inicio', view === 'home')}
        {(can('cliente.consultar') || can('expediente.consultar')) && (
          <p className="nav-group">Clientes y casos</p>
        )}
        {can('cliente.consultar') &&
          link(
            'clients',
            'Clientes',
            ['clients', 'client', 'new-client'].includes(view),
          )}
        {can('expediente.consultar') &&
          link(
            'cases',
            'Expedientes',
            ['cases', 'case', 'new-case'].includes(view),
          )}
        {roles.includes('ABOGADO') &&
          can('expediente.consultar') &&
          link('assigned', 'Mis expedientes', view === 'assigned')}
        {can('expediente.reasignar') &&
          link('reassign', 'Reasignar expedientes', view === 'reassign')}
        {can('documento.consultar') &&
          link('documents', 'Documentos', view === 'documents')}
        {can('documento.recuperar') &&
          link(
            'retired-documents',
            'Documentos retirados',
            view === 'retired-documents',
          )}
        {(can('usuario.administrar') ||
          can('usuario.permisos') ||
          can('auditoria.consultar') ||
          can('configuracion.administrar')) && (
          <p className="nav-group">Administración</p>
        )}
        {(can('usuario.administrar') || can('usuario.permisos')) &&
          link('staff', 'Usuarios y permisos', view === 'staff')}
        {can('auditoria.consultar') &&
          link('audit', 'Bitácora', view === 'audit')}
        {can('configuracion.administrar') &&
          link('configuration', 'Configuración', view === 'configuration')}
        <p className="nav-group">Cuenta</p>
        {link('session', 'Mi sesión', view === 'session')}
      </nav>
      <div className="sidebar-user">
        <div className="entity-label">
          <Icon name="person" />
          <span>
            <strong>{name}</strong>
            <small>{roles.join(' · ') || 'Sin roles asignados'}</small>
          </span>
        </div>
      </div>
    </aside>
  );
}
