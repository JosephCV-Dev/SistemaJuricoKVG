import { Injectable } from '@nestjs/common';
import { KvgRpcService } from '../../../infrastructure/supabase/kvg-rpc.service';
import {
  invalidRpcResult,
  rpcArray,
  rpcDate,
  rpcInteger,
  rpcRecord,
  rpcText,
} from '../../../infrastructure/supabase/rpc-result';
import { ClientsRepository } from '../application/clients.repository';
import type {
  Client,
  ClientInformation,
  ClientSearch,
  NewClient,
} from '../domain/client.types';

export function readClient(value: unknown): Client {
  const row = rpcRecord(value);
  return {
    id: rpcText(row.cliente_id),
    name: rpcText(row.nombre_presentacion),
    type: rpcText(row.tipo_cliente),
    createdAt: rpcDate(row.creado_en),
    revision: rpcInteger(row.revision),
  };
}

@Injectable()
export class KvgClientsRepository extends ClientsRepository {
  constructor(private readonly rpc: KvgRpcService) {
    super();
  }
  async register(token: string, input: NewClient) {
    return readClient(
      await this.rpc.execute(token, 'cliente.registrar', {
        solicitud_id: input.requestId,
        nombre: input.name,
        identificaciones: input.identifications.map((item) => ({
          tipo: item.type,
          valor: item.value,
        })),
        contactos: input.contacts.map((item) => ({
          tipo: item.type,
          valor: item.value,
          preferente: item.preferred,
          ...(item.label ? { etiqueta: item.label } : {}),
        })),
      }),
    );
  }
  async get(token: string, id: string): Promise<ClientInformation> {
    const row = rpcRecord(
      await this.rpc.execute(token, 'cliente.consultar', { cliente_id: id }),
    );
    return {
      ...readClient(row),
      identifications: rpcArray(row.identificaciones, (value) => {
        const item = rpcRecord(value);
        return {
          type: rpcText(item.tipo_identificacion_codigo),
          value: rpcText(item.valor_original),
        };
      }),
      contacts: rpcArray(row.contactos, (value) => {
        const item = rpcRecord(value);
        if (
          !['CORREO', 'TELEFONO'].includes(String(item.tipo)) ||
          typeof item.preferente !== 'boolean'
        )
          return invalidRpcResult();
        return {
          type: item.tipo as 'CORREO' | 'TELEFONO',
          value: rpcText(item.valor),
          preferred: item.preferente,
          ...(item.etiqueta === null ? {} : { label: rpcText(item.etiqueta) }),
        };
      }),
    };
  }
  async search(token: string, input: ClientSearch) {
    return rpcArray(
      await this.rpc.execute(token, 'cliente.buscar', {
        texto: input.text || null,
        limite: input.limit,
        desplazamiento: input.offset,
      }),
      readClient,
    );
  }
  async identificationTypes(token: string) {
    const result = rpcRecord(
      await this.rpc.execute(token, 'catalogos.consultar', {}),
    );
    return rpcArray(result.tipos_identificacion, (value) => {
      const row = rpcRecord(value);
      if (typeof row.unicidad_exigida !== 'boolean') return invalidRpcResult();
      return {
        code: rpcText(row.tipo_identificacion_codigo),
        name: rpcText(row.nombre),
        unique: row.unicidad_exigida,
      };
    });
  }
}
