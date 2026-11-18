import { Injectable } from '@nestjs/common';
import { StaffRepository } from '../application/staff.ports';
import type {
  CaseStaffAccess,
  ChangeCapabilityInput,
  ChangeStaffRoleInput,
  GrantStaffAccessInput,
  PermissionContext,
  ReserveInvitationInput,
  StaffAccount,
  StaffAccess,
  StaffDetail,
  StaffMatrix,
  StaffRevisionInput,
  StaffRole,
  StaffStatus,
} from '@kvg/contracts';
import { KvgRpcService } from '../../../infrastructure/supabase/kvg-rpc.service';
import {
  invalidRpcResult,
  rpcArray as array,
  rpcDate as date,
  rpcInteger as integer,
  rpcNullableText as nullable,
  rpcRecord as record,
  rpcText as text,
} from '../../../infrastructure/supabase/rpc-result';

import { staffContexts, staffRoles } from '../domain/staff.types';
const staffStatuses = ['INVITADO', 'ACTIVO', 'DESACTIVADO'] as const;
function role(value: unknown): StaffRole {
  return staffRoles.find((entry) => entry === value) ?? invalidRpcResult();
}
function state(value: unknown): StaffStatus {
  return staffStatuses.find((entry) => entry === value) ?? invalidRpcResult();
}
function context(value: unknown): PermissionContext {
  return staffContexts.find((entry) => entry === value) ?? invalidRpcResult();
}
function flag(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalidRpcResult();
}
function account(value: unknown): StaffAccount {
  const row = record(value);
  return {
    id: text(row.usuario_id),
    name: text(row.nombre),
    email: text(row.correo_operativo),
    status: state(row.estado_cuenta),
    revision: integer(row.revision),
  };
}
function access(value: unknown): StaffAccess {
  const row = record(value);
  return {
    id: text(row.id),
    caseFolio: text(row.folio),
    name: text(row.nombre),
    expiresAt: row.vence === null ? null : date(row.vence),
    permissions: array(row.permisos, text),
  };
}
function page<T>(items: T[], limit: number, offset: number) {
  return {
    items: items.slice(0, limit),
    limit,
    offset,
    hasMore: items.length > limit && offset + limit <= 10000,
  };
}

@Injectable()
export class KvgStaffRepository extends StaffRepository {
  constructor(private readonly rpc: KvgRpcService) {
    super();
  }
  async list(
    token: string,
    input: { text?: string; limit: number; offset: number },
  ) {
    const rows = await this.rpc.execute(token, 'usuario.listar', {
      texto: input.text ?? '',
      limite: input.limit + 1,
      desplazamiento: input.offset,
    });
    return page(array(rows, account), input.limit, input.offset);
  }
  async detail(token: string, id: string): Promise<StaffDetail> {
    const row = record(
      await this.rpc.execute(token, 'usuario.detalle', { usuario_id: id }),
    );
    return {
      ...account(row),
      roles: array(row.roles, role),
      accesses: array(row.concesiones, access),
      requiresReassignment: flag(row.requiere_relevo),
    };
  }
  async reserve(token: string, input: ReserveInvitationInput) {
    return account(
      await this.rpc.execute(token, 'usuario.invitar', {
        nombre: input.name,
        correo: input.email,
        motivo: input.reason,
        solicitud_id: input.requestId,
      }),
    );
  }
  async invitationEmail(token: string, id: string) {
    const row = record(
      await this.rpc.execute(token, 'usuario.destino_invitacion', {
        usuario_id: id,
      }),
    );
    return text(row.correo);
  }
  async checkInvitation(accessToken: string) {
    await this.rpc.execute(accessToken, 'identidad.validar_invitacion', {});
  }
  async update(
    token: string,
    id: string,
    input: StaffRevisionInput & { name: string },
  ) {
    return account(
      await this.rpc.execute(token, 'usuario.editar', {
        usuario_id: id,
        revision: input.revision,
        nombre: input.name,
        motivo: input.reason,
      }),
    );
  }
  async deactivate(token: string, id: string, input: StaffRevisionInput) {
    const row = record(
      await this.rpc.execute(token, 'usuario.desactivar', {
        usuario_id: id,
        revision: input.revision,
        motivo: input.reason,
      }),
    );
    return { account: account(row), authId: nullable(row.auth_id) };
  }
  async disabledAuthId(token: string, id: string) {
    const row = record(
      await this.rpc.execute(token, 'usuario.identidad_desactivada', {
        usuario_id: id,
      }),
    );
    return nullable(row.auth_id);
  }
  async changeRole(token: string, id: string, input: ChangeStaffRoleInput) {
    const op =
      input.action === 'grant'
        ? 'seguridad.otorgar_rol'
        : 'seguridad.revocar_rol';
    await this.rpc.execute(token, op, {
      usuario_id: id,
      rol: input.role,
      revision: input.revision,
      motivo: input.reason,
      referencia_autorizacion: input.approval,
    });
  }
  async matrix(
    token: string,
    input: { role: StaffRole; limit: number; offset: number },
  ): Promise<StaffMatrix> {
    const row = record(
      await this.rpc.execute(token, 'seguridad.consultar_matriz', {
        rol: input.role,
        limite: input.limit + 1,
        desplazamiento: input.offset,
      }),
    );
    const items = array(row.capacidades, (value) => {
      const item = record(value);
      return {
        role: role(item.rol),
        permission: text(item.permiso),
        context: context(item.contexto),
        active: flag(item.activo),
        revision: integer(item.revision),
      };
    });
    return {
      ...page(items, input.limit, input.offset),
      canEdit: flag(row.puede_editar),
    };
  }
  async changeCapability(token: string, input: ChangeCapabilityInput) {
    await this.rpc.execute(token, 'seguridad.matriz', {
      rol: input.role,
      permiso: input.permission,
      contexto: input.context,
      activo: input.active,
      revision: input.revision,
      motivo: input.reason,
      referencia_autorizacion: input.approval,
    });
  }
  async caseAccesses(
    token: string,
    caseId: string,
    email?: string,
  ): Promise<CaseStaffAccess> {
    const row = record(
      await this.rpc.execute(token, 'seguridad.accesos_expediente', {
        expediente_id: caseId,
        ...(email ? { correo: email } : {}),
      }),
    );
    const candidate = row.usuario === null ? null : record(row.usuario);
    return {
      candidate: candidate && {
        id: text(candidate.id),
        name: text(candidate.nombre),
      },
      permissions: array(row.permisos, text),
      accesses: array(row.concesiones, access),
    };
  }
  async grant(token: string, caseId: string, input: GrantStaffAccessInput) {
    await this.rpc.execute(token, 'seguridad.conceder', {
      expediente_id: caseId,
      usuario_id: input.userId,
      permisos: input.permissions,
      motivo: input.reason,
      referencia_autorizacion: input.approval,
      ...(input.expiresAt ? { expira_en: input.expiresAt } : {}),
    });
  }
  async revoke(token: string, id: string, reason: string) {
    await this.rpc.execute(token, 'seguridad.revocar_concesion', {
      concesion_id: id,
      motivo: reason,
    });
  }
}
