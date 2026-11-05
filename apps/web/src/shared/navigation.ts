export type WorkspaceView =
  | 'home'
  | 'clients'
  | 'new-client'
  | 'client'
  | 'cases'
  | 'case'
  | 'new-case'
  | 'session';

export const viewTitles: Record<WorkspaceView, string> = {
  home: 'Inicio',
  clients: 'Clientes',
  'new-client': 'Nuevo cliente',
  client: 'Detalle del cliente',
  cases: 'Expedientes',
  case: 'Detalle del expediente',
  'new-case': 'Nuevo expediente',
  session: 'Mi sesión',
};
