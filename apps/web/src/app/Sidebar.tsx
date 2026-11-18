import type { SessionCapabilities } from '@kvg/contracts';
import type { WorkspaceView } from '../shared/navigation';

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
  const can = (permission: string) =>
    capabilities.some((item) => item.permission === permission);
  const link = (target: WorkspaceView, label: string, active: boolean) => (
    <button
      type="button"
      className="nav-link"
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(target)}
    >
      {label}
    </button>
  );
  return (
    <aside className="sidebar" aria-label="Menú del sistema">
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
      <nav aria-label="Navegación principal">
        {link('home', 'Inicio', view === 'home')}
        {(can('cliente.consultar') || can('expediente.consultar')) && (
          <p className="nav-group">Clientes y casos</p>
        )}
        {can('cliente.consultar') &&
          link(
            'clients',
            'Clientes',
            ['clients', 'client', 'new-client', 'new-case'].includes(view),
          )}
        {can('expediente.consultar') &&
          link('cases', 'Expedientes', ['cases', 'case'].includes(view))}
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
        {(can('usuario.administrar') || can('usuario.permisos')) &&
          link('staff', 'Usuarios y permisos', view === 'staff')}
        <p className="nav-group">Cuenta</p>
        {link('session', 'Mi sesión', view === 'session')}
      </nav>
      <div className="sidebar-user">
        <strong>{name}</strong>
        <small>{roles.join(' · ') || 'Sin roles asignados'}</small>
      </div>
    </aside>
  );
}
