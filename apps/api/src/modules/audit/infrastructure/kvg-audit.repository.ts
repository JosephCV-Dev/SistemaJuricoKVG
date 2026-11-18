import { Injectable } from '@nestjs/common';
import type { AuditEvent, AuditEventDetail, AuditPage } from '@kvg/contracts';
import { KvgRpcService } from '../../../infrastructure/supabase/kvg-rpc.service';
import {
  rpcArray,
  rpcDate,
  rpcNullableText,
  rpcRecord,
  rpcText,
  invalidRpcResult,
} from '../../../infrastructure/supabase/rpc-result';

function event(value: unknown): AuditEvent {
  const row = rpcRecord(value);
  const result = row.resultado;
  if (
    result !== 'EXITO' &&
    result !== 'DENEGADO' &&
    result !== 'FALLIDO' &&
    result !== 'RECIBIDO'
  )
    return invalidRpcResult();
  return {
    id: rpcText(row.evento_id),
    at: rpcDate(row.ocurrido_en),
    actorType: rpcText(row.tipo_actor),
    actorId: rpcNullableText(row.usuario_id),
    actor: rpcNullableText(row.actor),
    action: rpcText(row.accion),
    resourceType: rpcText(row.recurso_tipo),
    resourceId: rpcNullableText(row.recurso_id),
    correlationId: rpcText(row.correlacion_id),
    result,
  };
}
function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : null;
}

@Injectable()
export class KvgAuditRepository {
  constructor(private readonly rpc: KvgRpcService) {}

  async list(
    token: string,
    query: {
      limit: number;
      from?: string;
      until?: string;
      actor?: string;
      action?: string;
      resource?: string;
      result?: string;
      beforeAt?: string;
      beforeId?: string;
    },
  ): Promise<AuditPage> {
    const rows = rpcArray(
      await this.rpc.execute(token, 'auditoria.consultar', {
        limite: query.limit + 1,
        ...(query.from ? { desde: query.from } : {}),
        ...(query.until ? { hasta: query.until } : {}),
        ...(query.actor ? { actor: query.actor } : {}),
        ...(query.action ? { accion: query.action } : {}),
        ...(query.resource ? { recurso: query.resource } : {}),
        ...(query.result ? { resultado: query.result } : {}),
        ...(query.beforeAt
          ? { antes_de: query.beforeAt, antes_id: query.beforeId }
          : {}),
      }),
      event,
    );
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      next:
        last && rows.length > query.limit
          ? { beforeAt: last.at, beforeId: last.id }
          : null,
    };
  }

  async detail(token: string, id: string): Promise<AuditEventDetail> {
    const row = rpcRecord(
      await this.rpc.execute(token, 'auditoria.detalle', { evento_id: id }),
    );
    return {
      ...event(row),
      revision: safeNumber(row.revision),
      quantity: safeNumber(row.cantidad),
    };
  }
}
