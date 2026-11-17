import type {
  CaseAssignment,
  CaseAssignmentResult,
  CaseAssignmentSummary,
  CaseParticipation,
} from '@kvg/contracts';
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
  AssignedSearch,
  AssignmentChange,
  ReassignmentChange,
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
      canAssign: row.puede_asignar === true,
      clientName: rpcNullableText(row.nombre_cliente ?? null),
      canEdit: row.puede_editar === true,
      assignments: rpcArray(row.asignaciones, (value) => {
        const item = rpcRecord(value);
        const now = Date.now();
        return {
          userId: rpcText(item.abogado_id),
          name: rpcText(item.nombre_abogado),
          function: rpcText(item.funcion),
          startsAt: rpcDate(item.inicia_en),
          endsAt: item.finaliza_en === null ? null : rpcDate(item.finaliza_en),
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
  async assigned(token: string, input: AssignedSearch) {
    const rows = await this.rpc.execute(token, 'expediente.asignados', {
      ...searchPage(input),
      estado: input.status || null,
      desde: input.from || null,
      hasta: input.to || null,
      participacion: input.participation || null,
    });
    return rpcArray(rows, (value) => {
      const row = rpcRecord(value);
      const participation = rpcArray(
        row.participaciones,
        (item): CaseParticipation => {
          if (item === 'EXPLICITO') return item;
          return assignmentRole(item);
        },
      );
      if (!participation.length) return invalidRpcResult();
      return { ...readCase(row), participation };
    });
  }
  async reassignable(token: string, input: CaseSearch) {
    return rpcArray(
      await this.rpc.execute(
        token,
        'expediente.reasignables',
        searchPage(input),
      ),
      readAssignmentSummary,
    );
  }
  async team(
    token: string,
    id: string,
    input: CaseSearch,
    forReassignment: boolean,
  ) {
    const row = rpcRecord(
      await this.rpc.execute(
        token,
        forReassignment
          ? 'expediente.equipo_reasignacion'
          : 'expediente.equipo',
        {
          expediente_id: id,
          ...searchPage(input),
        },
      ),
    );
    return {
      ...readAssignmentSummary(row),
      revision: rpcInteger(row.revision),
      assignments: rpcArray(row.equipo, readAssignment),
      lawyers: rpcArray(row.abogados, (value) => {
        const lawyer = rpcRecord(value);
        return { id: rpcText(lawyer.usuario_id), name: rpcText(lawyer.nombre) };
      }),
    };
  }
  async assign(token: string, id: string, input: AssignmentChange) {
    return readAssignmentResult(
      await this.rpc.execute(token, 'expediente.asignar', {
        expediente_id: id,
        abogado_id: input.lawyerId,
        revision: input.revision,
        motivo: input.reason,
        funcion: input.role,
      }),
    );
  }
  async reassign(token: string, id: string, input: ReassignmentChange) {
    return readAssignmentResult(
      await this.rpc.execute(token, 'expediente.reasignar', {
        expediente_id: id,
        abogado_id: input.lawyerId,
        revision: input.revision,
        motivo: input.reason,
        referencia_autorizacion: input.approvalReference,
        conservar_colaboracion: input.keepCollaborator,
      }),
    );
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

function searchPage(input: CaseSearch) {
  return {
    texto: input.text || null,
    limite: input.limit,
    desplazamiento: input.offset,
  };
}
function assignmentRole(value: unknown): CaseAssignment['role'] {
  if (value === 'PRINCIPAL' || value === 'COLABORADOR') return value;
  return invalidRpcResult();
}
function readAssignment(value: unknown): CaseAssignment {
  const row = rpcRecord(value);
  return {
    id: rpcText(row.asignacion_id),
    userId: rpcText(row.abogado_id),
    name: rpcText(row.nombre_abogado),
    role: assignmentRole(row.funcion),
    startsAt: rpcDate(row.inicia_en),
    endsAt: row.finaliza_en === null ? null : rpcDate(row.finaliza_en),
  };
}
function readAssignmentSummary(value: unknown): CaseAssignmentSummary {
  const row = rpcRecord(value);
  const status = row.estado_expediente_codigo;
  if (
    status !== 'NUEVO' &&
    status !== 'EN_PROCESO' &&
    status !== 'PENDIENTE' &&
    status !== 'CONCLUIDO' &&
    status !== 'ARCHIVADO'
  )
    return invalidRpcResult();
  return {
    id: rpcText(row.expediente_id),
    folio: rpcText(row.folio_interno),
    status,
  };
}
function readAssignmentResult(value: unknown): CaseAssignmentResult {
  const row = rpcRecord(value);
  return {
    assignmentId: rpcText(row.asignacion_id),
    caseId: rpcText(row.expediente_id),
    revision: rpcInteger(row.revision),
  };
}
