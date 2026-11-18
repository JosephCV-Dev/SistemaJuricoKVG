import { Injectable } from '@nestjs/common';
import type {
  DocumentUploadInput,
  DocumentSummary,
  DocumentDetail,
  UploadState,
  DocumentFilters,
  DocumentClassificationInput,
  DocumentAssociationInput,
  DocumentOrganizationResult,
} from '@kvg/contracts';
import { KvgRpcService } from '../../../infrastructure/supabase/kvg-rpc.service';
import {
  rpcRecord as obj,
  rpcText as text,
  rpcNullableText as nullable,
  rpcInteger as integer,
  rpcArray as array,
  rpcDate as date,
  invalidRpcResult,
} from '../../../infrastructure/supabase/rpc-result';
import { DocumentsRepository } from '../application/documents.repository';
const states = [
  'RECIBIENDO',
  'PENDIENTE_VERIFICACION',
  'HABILITADO',
  'RECHAZADO',
  'ERROR_VERIFICACION',
  'ABANDONADO',
];
const upload = (value: unknown) => {
  const r = obj(value);
  const state = text(r.estado);
  if (!states.includes(state)) return invalidRpcResult();
  return {
    id: text(r.carga_id),
    documentId: text(r.documento_id),
    state: state as UploadState,
  };
};
const summary = (value: unknown): DocumentSummary => {
  const r = obj(value);
  return {
    id: text(r.documento_id),
    caseId: text(r.expediente_id),
    name: text(r.nombre),
    categoryId: text(r.categoria_id),
    ...(r.nombre_categoria !== undefined
      ? { categoryName: text(r.nombre_categoria) }
      : {}),
    ...(r.folio_expediente !== undefined
      ? { caseFolio: nullable(r.folio_expediente) }
      : {}),
    ...(r.creado_en !== undefined ? { createdAt: date(r.creado_en) } : {}),
    versionId: nullable(r.version_vigente_id),
    number: r.numero_version == null ? null : integer(r.numero_version),
    status: nullable(r.estado_documento_codigo),
  };
};
@Injectable()
export class KvgDocumentsRepository extends DocumentsRepository {
  constructor(private readonly rpc: KvgRpcService) {
    super();
  }
  async create(token: string, i: DocumentUploadInput) {
    return upload(
      await this.rpc.execute(token, 'documento.cargar', {
        clave_idempotencia: i.requestId,
        expediente_id: i.caseId,
        nombre: i.name,
        categoria_id: i.categoryId,
        nombre_original: i.originalName,
        motivo: i.reason,
      }),
    );
  }
  async upload(token: string, id: string) {
    const r = obj(
      await this.rpc.execute(token, 'documento.carga', { carga_id: id }),
    );
    return {
      ...upload(r),
      caseId: text(r.expediente_id),
      versionId: nullable(r.version_id),
      result: nullable(r.resultado),
    };
  }
  async categories(token: string) {
    const r = obj(await this.rpc.execute(token, 'catalogos.consultar', {}));
    return array(r.categorias ?? [], (v) => {
      const c = obj(v);
      return { id: text(c.categoria_id), name: text(c.nombre) };
    });
  }
  async search(
    token: string,
    filters: DocumentFilters & { limit: number; offset: number },
  ) {
    const {
      caseId,
      categoryId,
      text: term,
      folio,
      client,
      from,
      to,
      status,
      order,
      limit,
      offset,
    } = filters;
    return page(
      array(
        await this.rpc.execute(token, 'documento.buscar', {
          ...(caseId ? { expediente_id: caseId } : {}),
          ...(categoryId ? { categoria_id: categoryId } : {}),
          ...(term ? { texto: term } : {}),
          ...(folio ? { folio } : {}),
          ...(client ? { cliente: client } : {}),
          ...(from ? { desde: from } : {}),
          ...(to ? { hasta: to } : {}),
          ...(status ? { estado: status } : {}),
          ...(order ? { orden: order } : {}),
          limite: limit + 1,
          desplazamiento: offset,
        }),
        summary,
      ),
      limit,
      offset,
    );
  }
  async destinations(
    token: string,
    id: string,
    query: { text?: string; limit: number; offset: number },
  ) {
    return page(
      array(
        await this.rpc.execute(token, 'documento.destinos', {
          documento_id: id,
          texto: query.text || null,
          limite: query.limit + 1,
          desplazamiento: query.offset,
        }),
        (value) => {
          const row = obj(value);
          return {
            id: text(row.expediente_id),
            folio: text(row.folio_interno),
          };
        },
      ),
      query.limit,
      query.offset,
    );
  }
  async classify(
    token: string,
    id: string,
    input: DocumentClassificationInput,
  ) {
    return organized(
      await this.rpc.execute(token, 'documento.clasificar', {
        documento_id: id,
        revision: input.revision,
        categoria_id: input.categoryId,
        ...(input.reason ? { motivo: input.reason } : {}),
      }),
    );
  }
  async associate(token: string, id: string, input: DocumentAssociationInput) {
    return organized(
      await this.rpc.execute(token, 'documento.asociar', {
        documento_id: id,
        revision: input.revision,
        expediente_destino_id: input.destinationId,
        motivo: input.reason,
      }),
    );
  }
  async get(token: string, id: string): Promise<DocumentDetail> {
    const r = obj(
      await this.rpc.execute(token, 'documento.consultar', {
        documento_id: id,
      }),
    );
    const v = r.version == null ? null : obj(r.version);
    return {
      ...summary({
        ...r,
        numero_version: v?.numero_version ?? null,
        estado_documento_codigo: v?.estado_documento_codigo ?? null,
      }),
      revision: integer(r.revision),
      canClassify: r.puede_clasificar === true,
      canAssociate: r.puede_asociar === true,
      fileAvailable:
        typeof r.archivo_disponible === 'boolean'
          ? r.archivo_disponible
          : v !== null,
      classifications: array(r.clasificaciones ?? [], (value) => {
        const row = obj(value);
        return {
          id: text(row.id),
          previous: text(row.anterior),
          category: text(row.nueva),
          reason: nullable(row.motivo),
          author: text(row.autor),
          at: date(row.fecha),
        };
      }),
      associations: array(r.asociaciones ?? [], (value) => {
        const row = obj(value);
        if (typeof row.tiene_origen !== 'boolean') return invalidRpcResult();
        return {
          id: text(row.id),
          hasSource: row.tiene_origen,
          sourceFolio: nullable(row.origen),
          destinationFolio: nullable(row.destino),
          reason: nullable(row.motivo),
          author: text(row.autor),
          at: date(row.fecha),
        };
      }),
      createdAt: date(r.creado_en),
      authorId: text(r.creado_por),
      authorName: text(r.nombre_autor),
      categoryName: text(r.nombre_categoria),
      version: v
        ? {
            id: text(v.version_id),
            number: integer(v.numero_version),
            sha256: text(v.sha256),
            size: integer(v.tamano_bytes),
            format: text(v.formato),
            status: text(v.estado_documento_codigo),
            publishedAt: date(v.publicado_en),
            ...(v.sin_antimalware === true ? { beta: true as const } : {}),
          }
        : null,
    };
  }
  async authorizeDownload(token: string, id: string) {
    const r = obj(
      await this.rpc.execute(token, 'documento.descargar', { version_id: id }),
    );
    return {
      id: text(r.autorizacion_id),
      sha256: text(r.sha256),
      size: integer(r.tamano_bytes),
    };
  }
}

function page<T>(items: T[], limit: number, offset: number) {
  return {
    items: items.slice(0, limit),
    offset,
    limit,
    hasMore: items.length > limit && offset + limit <= 10000,
  };
}
function organized(value: unknown): DocumentOrganizationResult {
  const row = obj(value);
  return {
    id: text(row.documento_id),
    caseId: text(row.expediente_id),
    revision: integer(row.revision),
  };
}
