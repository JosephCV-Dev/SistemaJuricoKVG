import { Injectable } from '@nestjs/common';
import type {
  DocumentUploadInput,
  DocumentSummary,
  DocumentDetail,
  UploadState,
  DocumentFilters,
  DocumentClassificationInput,
  DocumentAssociationInput,
  DocumentVersionUploadInput,
  DocumentMetadataInput,
  DocumentVersion,
  DocumentVersionHistoryEntry,
  DocumentReviewInput,
  DocumentReviewResult,
  DocumentVersionReview,
  DocumentLegalReview,
  DocumentStateChange,
  DocumentStateInput,
  DocumentStateResult,
  RetireDocumentInput,
  RecoverDocumentInput,
  DocumentRecoveryState,
  DocumentRecoveryStatus,
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
import {
  DOCUMENT_REVIEW_OUTCOMES,
  DOCUMENT_STATES,
} from '../domain/document.types';
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
function version(r: Record<string, unknown>): DocumentVersion {
  return {
    id: text(r.version_id),
    number: integer(r.numero_version),
    sha256: text(r.sha256),
    size: integer(r.tamano_bytes),
    format: text(r.formato),
    status: text(r.estado_documento_codigo),
    publishedAt: date(r.publicado_en),
    ...(r.sin_antimalware === true ? { beta: true as const } : {}),
  };
}

function versionHistory(value: unknown): DocumentVersionHistoryEntry {
  const row = obj(value);
  if (
    typeof row.vigente !== 'boolean' ||
    typeof row.puede_descargar !== 'boolean'
  )
    return invalidRpcResult();
  return {
    ...version(row),
    author: text(row.autor),
    reason: text(row.motivo),
    current: row.vigente,
    canDownload: row.puede_descargar,
    reviews: array(row.revisiones, (value) => {
      const review = obj(value);
      return {
        id: text(review.id),
        author: text(review.autor),
        result: text(review.resultado),
        at: date(review.fecha),
      };
    }),
  };
}
function flag(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalidRpcResult();
}
function recoveryState(value: unknown): DocumentRecoveryState {
  switch (value) {
    case 'EN_COLA':
    case 'EN_EJECUCION':
    case 'COMPLETADO':
    case 'FALLIDO':
    case 'CANCELADO':
      return value;
    default:
      return invalidRpcResult();
  }
}
function recoveryStatus(value: unknown): DocumentRecoveryStatus {
  const row = obj(value);
  const mode = row.modo;
  if (mode !== null && mode !== 'BETA' && mode !== 'VERIFICADO')
    return invalidRpcResult();
  return {
    id: text(row.trabajo_id),
    documentId: text(row.documento_id),
    state: recoveryState(row.estado),
    result: nullable(row.resultado),
    mode,
  };
}
function documentState(value: unknown) {
  return DOCUMENT_STATES.find((state) => state === value) ?? invalidRpcResult();
}
function stateResult(row: Record<string, unknown>): DocumentStateResult {
  return {
    versionId: text(row.version_id),
    status: documentState(row.estado),
    revision: integer(row.revision),
  };
}
function timelineEvent(
  value: unknown,
): DocumentLegalReview | DocumentStateChange {
  const row = obj(value);
  const shared = {
    id: text(row.id),
    author: text(row.autor),
    at: date(row.fecha),
  };
  switch (row.tipo) {
    case 'revision':
      return {
        ...shared,
        kind: 'review',
        result:
          DOCUMENT_REVIEW_OUTCOMES.find((result) => result === row.resultado) ??
          invalidRpcResult(),
        observations: text(row.observaciones),
        correctsId: nullable(row.corrige_id),
        superseded: flag(row.corregida),
      };
    case 'estado':
      return {
        ...shared,
        kind: 'state',
        previous: row.origen === null ? null : documentState(row.origen),
        status: documentState(row.destino),
        reason: text(row.motivo),
        reviewId: nullable(row.revision_juridica_id),
      };
    default:
      return invalidRpcResult();
  }
}
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
  async createVersion(
    token: string,
    id: string,
    input: DocumentVersionUploadInput,
  ) {
    return upload(
      await this.rpc.execute(token, 'documento.cargar', {
        documento_id: id,
        revision: input.revision,
        clave_idempotencia: input.requestId,
        nombre_original: input.originalName,
        motivo: input.reason,
      }),
    );
  }
  async updateMetadata(
    token: string,
    id: string,
    input: DocumentMetadataInput,
  ) {
    return organized(
      await this.rpc.execute(token, 'documento.actualizar', {
        documento_id: id,
        revision: input.revision,
        nombre: input.name,
        motivo: input.reason,
      }),
    );
  }
  async versions(
    token: string,
    id: string,
    { limit, offset }: { limit: number; offset: number },
  ) {
    return page(
      array(
        await this.rpc.execute(token, 'documento.versiones', {
          documento_id: id,
          limite: limit + 1,
          desplazamiento: offset,
        }),
        versionHistory,
      ),
      limit,
      offset,
    );
  }
  async versionReview(
    token: string,
    id: string,
    versionId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<DocumentVersionReview> {
    const row = obj(
      await this.rpc.execute(token, 'documento.revision', {
        documento_id: id,
        version_id: versionId,
        limite: limit + 1,
        desplazamiento: offset,
      }),
    );
    return {
      ...stateResult(row),
      number: integer(row.numero_version),
      current: flag(row.vigente),
      canReview: flag(row.puede_revisar),
      transitions: array(row.transiciones, (value) => {
        const transition = obj(value);
        return {
          status: documentState(transition.destino),
          requiresReview: flag(transition.requiere_revision),
        };
      }),
      timeline: page(array(row.eventos, timelineEvent), limit, offset),
    };
  }
  async review(
    token: string,
    id: string,
    versionId: string,
    input: DocumentReviewInput,
  ): Promise<DocumentReviewResult> {
    const row = obj(
      await this.rpc.execute(token, 'documento.revisar', {
        documento_id: id,
        version_id: versionId,
        solicitud_id: input.requestId,
        observaciones: input.observations,
        resultado: input.result,
        ...(input.correctsId ? { corrige_revision_id: input.correctsId } : {}),
      }),
    );
    return {
      id: text(row.revision_juridica_id),
      currentVersionChanged: flag(row.version_vigente_cambio),
    };
  }
  async changeState(
    token: string,
    id: string,
    versionId: string,
    input: DocumentStateInput,
  ): Promise<DocumentStateResult> {
    return stateResult(
      obj(
        await this.rpc.execute(token, 'documento.cambiar_estado', {
          documento_id: id,
          version_id: versionId,
          revision: input.revision,
          estado: input.status,
          motivo: input.reason,
          ...(input.reviewId ? { revision_juridica_id: input.reviewId } : {}),
        }),
      ),
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
      canEditName: r.puede_editar_nombre === true,
      canUploadVersion: r.puede_subir_version === true,
      canViewVersions: r.puede_ver_versiones === true,
      canRetire: r.puede_retirar === true,
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
      version: v ? version(v) : null,
    };
  }
  async retire(token: string, id: string, input: RetireDocumentInput) {
    const row = obj(
      await this.rpc.execute(token, 'documento.retirar', {
        documento_id: id,
        revision: input.revision,
        motivo: input.reason,
      }),
    );
    return { id: text(row.documento_id), revision: integer(row.revision) };
  }
  async retired(
    token: string,
    {
      text: filter,
      limit,
      offset,
    }: { text?: string; limit: number; offset: number },
  ) {
    const rows = await this.rpc.execute(token, 'documento.retirados', {
      texto: filter ?? '',
      limite: limit + 1,
      desplazamiento: offset,
    });
    return page(
      array(rows, (value) => {
        const row = obj(value);
        return {
          id: text(row.documento_id),
          caseFolio: nullable(row.folio_interno),
          retiredAt: date(row.retirado_en),
          revision: integer(row.revision),
          canRecover: flag(row.puede_recuperar),
          jobId: nullable(row.trabajo_id),
          jobState:
            row.estado_trabajo === null
              ? null
              : recoveryState(row.estado_trabajo),
        };
      }),
      limit,
      offset,
    );
  }
  async recover(token: string, id: string, input: RecoverDocumentInput) {
    return recoveryStatus(
      await this.rpc.execute(token, 'documento.recuperar', {
        documento_id: id,
        revision: input.revision,
        motivo: input.reason,
        clave_idempotencia: input.requestId,
      }),
    );
  }
  async recoveryStatus(token: string, id: string) {
    return recoveryStatus(
      await this.rpc.execute(token, 'documento.estado_recuperacion', {
        trabajo_id: id,
      }),
    );
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
