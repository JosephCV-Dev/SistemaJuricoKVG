import { Injectable } from '@nestjs/common';
import type {
  ConfigurationCategory,
  ConfigurationIdentification,
  ConfigurationParameter,
  ConfigurationSnapshot,
} from '@kvg/contracts';
import { KvgRpcService } from '../../../infrastructure/supabase/kvg-rpc.service';
import {
  invalidRpcResult,
  rpcArray,
  rpcInteger,
  rpcNullableText,
  rpcRecord,
  rpcText,
} from '../../../infrastructure/supabase/rpc-result';

function boolean(value: unknown) {
  return typeof value === 'boolean' ? value : invalidRpcResult();
}

function parameter(item: unknown): ConfigurationParameter {
  const row = rpcRecord(item);
  return {
    code: rpcText(row.parametro_codigo),
    value: rpcText(row.valor),
    rule: rpcText(row.regla_validacion),
    editable: boolean(row.editable),
    revision: rpcInteger(row.revision),
  };
}

function category(item: unknown): ConfigurationCategory {
  const row = rpcRecord(item);
  return {
    id: rpcText(row.categoria_id),
    code: rpcText(row.codigo),
    name: rpcText(row.nombre),
    description: rpcNullableText(row.descripcion),
    active: boolean(row.activo),
    revision: rpcInteger(row.revision),
  };
}

function identification(item: unknown): ConfigurationIdentification {
  const row = rpcRecord(item);
  const rule = row.regla_normalizacion;
  if (
    rule !== 'EXACTA_V1' &&
    rule !== 'MAYUSCULAS_V1' &&
    rule !== 'ALFANUMERICA_V1'
  )
    return invalidRpcResult();
  return {
    code: rpcText(row.tipo_identificacion_codigo),
    name: rpcText(row.nombre),
    rule,
    unique: boolean(row.unicidad_exigida),
    active: boolean(row.activo),
    revision: rpcInteger(row.revision),
  };
}

@Injectable()
export class KvgConfigurationRepository {
  constructor(private readonly rpc: KvgRpcService) {}

  async snapshot(token: string): Promise<ConfigurationSnapshot> {
    const row = rpcRecord(
      await this.rpc.execute(token, 'configuracion.catalogos', {}),
    );
    return {
      parameters: rpcArray(row.parametros, parameter),
      categories: rpcArray(row.categorias, category),
      identifications: rpcArray(row.identificaciones, identification),
    };
  }

  changeParameter(
    token: string,
    code: string,
    value: number,
    revision: number,
    reason: string,
  ) {
    return this.rpc.execute(token, 'configuracion.parametro', {
      codigo: code,
      valor: value,
      revision,
      motivo: reason,
    });
  }

  saveCategory(
    token: string,
    input: {
      name: string;
      description?: string | null;
      reason: string;
    } & ({ code: string } | { id: string; revision: number; active: boolean }),
  ) {
    return this.rpc.execute(token, 'configuracion.categoria', {
      ...('code' in input
        ? { codigo: input.code }
        : {
            categoria_id: input.id,
            revision: input.revision,
            activo: input.active,
          }),
      nombre: input.name,
      ...(input.description !== undefined
        ? { descripcion: input.description }
        : {}),
      motivo: input.reason,
    });
  }

  saveIdentification(
    token: string,
    input: {
      code: string;
      name: string;
      reason: string;
    } & (
      { rule: string; unique: boolean } | { revision: number; active: boolean }
    ),
  ) {
    return this.rpc.execute(token, 'configuracion.identificacion', {
      codigo: input.code,
      nombre: input.name,
      motivo: input.reason,
      ...('rule' in input
        ? { regla: input.rule, unicidad: input.unique }
        : {
            revision: input.revision,
            activo: input.active,
          }),
    });
  }
}
