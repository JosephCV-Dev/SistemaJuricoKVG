export type WorkspaceView =
  | 'home'
  | 'clients'
  | 'new-client'
  | 'client'
  | 'assigned'
  | 'reassign'
  | 'cases'
  | 'case'
  | 'new-case'
  | 'documents'
  | 'retired-documents'
  | 'staff'
  | 'audit'
  | 'configuration'
  | 'session';

export const viewTitles: Record<WorkspaceView, string> = {
  home: 'Inicio',
  clients: 'Clientes',
  'new-client': 'Nuevo cliente',
  client: 'Detalle del cliente',
  cases: 'Expedientes',
  assigned: 'Mis expedientes',
  reassign: 'Reasignación',
  case: 'Detalle del expediente',
  'new-case': 'Nuevo expediente',
  documents: 'Documentos',
  'retired-documents': 'Documentos retirados',
  staff: 'Usuarios y permisos',
  audit: 'Bitácora',
  configuration: 'Configuración',
  session: 'Mi sesión',
};
