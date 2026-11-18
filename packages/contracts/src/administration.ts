export type AuditResult = 'EXITO' | 'DENEGADO' | 'FALLIDO' | 'RECIBIDO';
export interface AuditCursor {
  beforeAt: string;
  beforeId: string;
}
export interface AuditEvent {
  id: string;
  at: string;
  actorType: string;
  actorId: string | null;
  actor: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: AuditResult;
  correlationId: string;
}
export interface AuditEventDetail extends AuditEvent {
  revision: number | null;
  quantity: number | null;
}
export interface AuditPage {
  items: AuditEvent[];
  next: AuditCursor | null;
}

export type SessionParameterCode =
  'sesion.inactividad_minutos' | 'sesion.duracion_horas';
export interface ConfigurationParameter {
  code: string;
  value: string;
  rule: string;
  revision: number;
  editable: boolean;
}
export interface ConfigurationCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  revision: number;
}
export type IdentificationRule =
  'EXACTA_V1' | 'MAYUSCULAS_V1' | 'ALFANUMERICA_V1';
export interface ConfigurationIdentification {
  code: string;
  name: string;
  rule: IdentificationRule;
  unique: boolean;
  active: boolean;
  revision: number;
}
export interface ConfigurationSnapshot {
  parameters: ConfigurationParameter[];
  categories: ConfigurationCategory[];
  identifications: ConfigurationIdentification[];
}
