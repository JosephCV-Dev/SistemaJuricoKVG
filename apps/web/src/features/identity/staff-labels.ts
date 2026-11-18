import type { StaffRole, StaffStatus } from '@kvg/contracts';

export const roleLabels: Record<StaffRole, string> = {
  SECRETARIA: 'Secretaría',
  ABOGADO: 'Abogacía',
  ADMINISTRADOR: 'Administración',
};
export const roleOptions = Object.keys(roleLabels) as StaffRole[];
export const statusLabels: Record<StaffStatus, string> = {
  INVITADO: 'Invitado',
  ACTIVO: 'Activo',
  DESACTIVADO: 'Desactivado',
};
