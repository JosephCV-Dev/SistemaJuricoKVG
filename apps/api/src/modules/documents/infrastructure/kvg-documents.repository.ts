import { Injectable } from '@nestjs/common';
import type {
  DocumentUploadInput,
  DocumentSummary,
  DocumentDetail,
  UploadState,
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
  async search(token: string, caseId: string, offset: number) {
    const items = array(
      await this.rpc.execute(token, 'documento.buscar', {
        expediente_id: caseId,
        limite: 21,
        desplazamiento: offset,
      }),
      summary,
    );
    return {
      items: items.slice(0, 20),
      offset,
      limit: 20,
      hasMore: items.length > 20,
    };
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
