export interface NewClient {
  requestId: string;
  name: string;
  identifications: Array<{ type: string; value: string }>;
  contacts: Array<{
    type: 'CORREO' | 'TELEFONO';
    value: string;
    preferred: boolean;
    label?: string;
  }>;
}
export interface ClientUpdate extends Partial<Omit<NewClient, 'requestId'>> {
  revision: number;
}
export interface Client {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  revision: number;
}
export interface ClientInformation extends Client {
  canEdit: boolean;
  identifications: NewClient['identifications'];
  contacts: NewClient['contacts'];
}
export interface IdentificationDefinition {
  code: string;
  name: string;
  unique: boolean;
}
export interface ClientSearch {
  text?: string;
  identification?: string;
  limit: number;
  offset: number;
}
