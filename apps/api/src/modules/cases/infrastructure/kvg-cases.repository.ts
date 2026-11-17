import { Injectable } from '@nestjs/common';
import { KvgRpcService } from '../../../infrastructure/supabase/kvg-rpc.service';
import {
  invalidRpcResult,
  rpcArray,
  rpcDate,
  rpcInteger,
  rpcNullableText,
  rpcRecord,
  rpcText,
} from '../../../infrastructure/supabase/rpc-result';
import { CasesRepository } from '../application/cases.repository';
import type {
  CaseInformation,
  CaseRecord,
  CaseSearch,
  CaseState,
  CaseUpdate,
  NewCase,
} from '../domain/case.types';

export function readCase(value: unknown): CaseRecord {
  const row = rpcRecord(value);
  if (
    !['NUEVO', 'EN_PROCESO', 'PENDIENTE', 'CONCLUIDO', 'ARCHIVADO'].includes(
      String(row.estado_expediente_codigo),
    )
  )
    return invalidRpcResult();
  return {
    id: rpcText(row.expediente_id),
    folio: rpcText(row.folio_interno),
    clientId: rpcText(row.cliente_principal_id),
    description: rpcText(row.descripcion),
    status: row.estado_expediente_codigo as CaseState,
    externalNumber: rpcNullableText(row.numero_externo),
    externalAuthority: rpcNullableText(row.autoridad_externa),
    createdAt: rpcDate(row.creado_en),
    revision: rpcInteger(row.revision),
  };
}
@Injectable()
export class KvgCasesRepository extends CasesRepository {
  constructor(private readonly rpc: KvgRpcService) {
    super();
  }
  async create(token: string, input: NewCase) {
    return readCase(
      await this.rpc.execute(token, 'expediente.crear', {
        solicitud_id: input.requestId,
        cliente_id: input.clientId,
        descripcion: input.description,
        ...(input.externalNumber
          ? { numero_externo: input.externalNumber }
          : {}),
        ...(input.externalAuthority
          ? { autoridad_externa: input.externalAuthority }
          : {}),
      }),
    );
  }
  async update(token: string, id: string, input: CaseUpdate) {
    return readCase(
      await this.rpc.execute(token, 'expediente.actualizar', {
        expediente_id: id,
        revision: input.revision,
        motivo: input.reason,
        ...(input.description === undefined
          ? {}
          : { descripcion: input.description }),
        ...(input.externalNumber === undefined
          ? {}
          : { numero_externo: input.externalNumber }),
        ...(input.externalAuthority === undefined
          ? {}
          : { autoridad_externa: input.externalAuthority }),
      }),
    );
  }
  async get(token: string, id: string): Promise<CaseInformation> {
    const row = rpcRecord(
      await this.rpc.execute(token, 'expediente.consultar', {
        expediente_id: id,
      }),
    );
    return {
      ...readCase(row),
      clientName: rpcNullableText(row.nombre_cliente ?? null),
      canEdit: row.puede_editar === true,
      assignments: rpcArray(row.asignaciones, (value) => {
        const item = rpcRecord(value);
        const now = Date.now();
        return {
          userId: rpcText(item.abogado_id),
          name: rpcText(item.nombre_abogado),
          function: rpcText(item.funcion),
          active:
            Date.parse(rpcDate(item.inicia_en)) <= now &&
            (item.finaliza_en === null ||
              Date.parse(rpcDate(item.finaliza_en)) > now),
        };
      }),
      history: rpcArray(row.historial_estados, (value) => {
        const item = rpcRecord(value);
        return {
          from: rpcNullableText(item.estado_origen_codigo),
          to: rpcText(item.estado_destino_codigo),
          reason: rpcText(item.motivo),
          at: rpcDate(item.registrado_en),
        };
      }),
      progress: rpcArray(row.avances, (value) => {
        const item = rpcRecord(value);
        return {
          description: rpcText(item.descripcion),
          at: rpcDate(item.registrado_en),
        };
      }),
    };
  }
  async search(token: string, input: CaseSearch) {
    return rpcArray(
      await this.rpc.execute(token, 'expediente.buscar', {
        texto: input.text || null,
        estado: input.status || null,
        ...(input.client ? { cliente: input.client } : {}),
        ...(input.responsible ? { responsable: input.responsible } : {}),
        limite: input.limit,
        desplazamiento: input.offset,
      }),
      readCase,
    );
  }
}
