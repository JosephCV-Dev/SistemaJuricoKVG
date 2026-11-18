import { useState } from 'react';
import type {
  ClassificationReason,
  DocumentCategory,
  DocumentDestination,
  DocumentDetail,
  DocumentVersionReview,
  RecordPage,
} from '@kvg/contracts';
import {
  categories,
  documentDestinations,
  documentVersionReview,
  organizeDocument,
  retireDocument,
  saveDocumentDownload,
  updateDocumentMetadata,
} from './documents-api';
import { DocumentVersions } from './DocumentVersions';
import { DocumentReview } from './DocumentReview';
import { documentStateLabels } from './document-format';

export type RunDocumentAction = (
  action: (signal: AbortSignal) => Promise<void>,
) => Promise<void>;
const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeZone: 'America/Merida',
});
export const documentDate = (value: string) =>
  dateFormatter.format(new Date(value));
const reasons: Record<ClassificationReason, string> = {
  CORREGIR_CLASIFICACION: 'Corregir clasificación',
  ORGANIZACION_CATALOGO: 'Organizar el catálogo',
  OTRA_CORRECCION: 'Otra corrección',
};

export function DocumentDetails({
  detail,
  busy,
  canDownload,
  run,
  onSaved,
  onRefresh,
  onDownload,
  onOpenCase,
  onRetired,
}: {
  detail: DocumentDetail;
  busy: boolean;
  canDownload: boolean;
  run: RunDocumentAction;
  onSaved: (id: string, signal: AbortSignal, message: string) => Promise<void>;
  onRefresh: () => void;
  onDownload: () => void;
  onOpenCase?: (id: string) => void;
  onRetired: (id: string, signal: AbortSignal) => Promise<void>;
}) {
  const [form, setForm] = useState<
    'metadata' | 'category' | 'association' | 'retire' | null
  >(null);
  const [name, setName] = useState(detail.name);
  const [nameReason, setNameReason] = useState('');
  const [catalog, setCatalog] = useState<DocumentCategory[]>([]);
  const [categoryId, setCategory] = useState('');
  const [classificationReason, setClassificationReason] = useState<
    ClassificationReason | ''
  >('');
  const [folio, setFolio] = useState('');
  const [query, setQuery] = useState('');
  const [targets, setTargets] =
    useState<RecordPage<DocumentDestination> | null>(null);
  const [destinationId, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [retirementReason, setRetirementReason] = useState('');
  const [review, setReview] = useState<DocumentVersionReview | null>(null);
  const original = detail.version;
  function openReview(versionId: string) {
    void run(async (signal) => {
      setReview(await documentVersionReview(detail.id, versionId, 0, signal));
    });
  }
  function searchDestinations(term: string, offset: number) {
    setTargets(null);
    setDestination('');
    void run(async (signal) => {
      setTargets(await documentDestinations(detail.id, term, offset, signal));
      setQuery(term);
    });
  }

  return (
    <div className="record-detail">
      <h4>Documento: {detail.name}</h4>
      {detail.version?.beta && <p>Archivo beta sin análisis antimalware.</p>}
      <dl>
        <dt>Expediente</dt>
        <dd>{detail.caseFolio ?? 'Folio restringido'}</dd>
        <dt>Categoría</dt>
        <dd>{detail.categoryName}</dd>
        <dt>Registrado</dt>
        <dd>{documentDate(detail.createdAt)}</dd>
        <dt>Autor</dt>
        <dd>{detail.authorName}</dd>
        <dt>Versión vigente</dt>
        <dd>
          {detail.version
            ? `v${detail.version.number} · ${detail.version.status.replaceAll('_', ' ')}`
            : 'Sin versión habilitada'}
        </dd>
        {detail.version && (
          <>
            <dt>Formato y tamaño</dt>
            <dd>
              {detail.version.format} · {detail.version.size} bytes
            </dd>
            <dt>SHA-256</dt>
            <dd>{detail.version.sha256}</dd>
          </>
        )}
        {detail.version && !detail.fileAvailable && (
          <>
            <dt>Disponibilidad</dt>
            <dd>Archivo no disponible</dd>
          </>
        )}
      </dl>
      <div className="actions">
        {original && detail.fileAvailable && canDownload && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async (signal) => {
                await saveDocumentDownload(detail.name, original, signal);
                onDownload();
              })
            }
          >
            Descargar original
          </button>
        )}
        {original && detail.fileAvailable && (
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={() => openReview(original.id)}
          >
            Revisión y estado
          </button>
        )}
        {detail.caseFolio && onOpenCase && (
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={() => onOpenCase(detail.caseId)}
          >
            Abrir expediente asociado
          </button>
        )}
        {detail.canClassify && !form && (
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async (signal) => {
                setCatalog(await categories(signal, true));
                setForm('category');
              })
            }
          >
            Clasificar documento
          </button>
        )}
        {detail.canAssociate && !form && (
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={() => setForm('association')}
          >
            Cambiar expediente
          </button>
        )}
        {detail.canEditName && !form && (
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={() => setForm('metadata')}
          >
            Editar metadatos
          </button>
        )}
        {detail.canRetire && !form && (
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={() => setForm('retire')}
          >
            Retirar documento
          </button>
        )}
      </div>

      {form === 'retire' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!retirementReason.trim()) return;
            void run(async (signal) => {
              const result = await retireDocument(
                detail.id,
                {
                  revision: detail.revision,
                  reason: retirementReason.trim(),
                },
                signal,
              );
              await onRetired(result.id, signal);
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>Confirmar retiro del documento</legend>
            <p>
              Se bloquearán la consulta y la descarga de todas las versiones.
              Los originales se conservarán.
            </p>
            <p>
              <label htmlFor="document-retirement-reason">
                Motivo del retiro
              </label>
              <textarea
                id="document-retirement-reason"
                required
                maxLength={2000}
                value={retirementReason}
                onChange={(event) => setRetirementReason(event.target.value)}
              />
            </p>
            <button type="submit" disabled={!retirementReason.trim()}>
              Confirmar retiro
            </button>
          </fieldset>
        </form>
      )}
      {form === 'metadata' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !name.trim() ||
              !nameReason.trim() ||
              name.trim() === detail.name
            )
              return;
            void run(async (signal) => {
              const result = await updateDocumentMetadata(
                detail.id,
                {
                  revision: detail.revision,
                  name: name.trim(),
                  reason: nameReason.trim(),
                },
                signal,
              );
              await onSaved(
                result.id,
                signal,
                'Nombre del documento actualizado.',
              );
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>Editar metadatos</legend>
            <p>
              <label htmlFor="document-edit-name">Nombre del documento</label>
              <input
                id="document-edit-name"
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </p>
            <p>
              <label htmlFor="document-edit-reason">
                Motivo del cambio de nombre
              </label>
              <textarea
                id="document-edit-reason"
                required
                maxLength={2000}
                value={nameReason}
                onChange={(event) => setNameReason(event.target.value)}
              />
            </p>
            <button
              type="submit"
              disabled={
                !name.trim() ||
                !nameReason.trim() ||
                name.trim() === detail.name
              }
            >
              Guardar metadatos
            </button>
          </fieldset>
        </form>
      )}
      {form === 'category' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!categoryId) return;
            void run(async (signal) =>
              onSaved(
                (
                  await organizeDocument(
                    detail.id,
                    {
                      revision: detail.revision,
                      categoryId,
                      ...(classificationReason
                        ? { reason: classificationReason }
                        : {}),
                    },
                    signal,
                  )
                ).id,
                signal,
                'Categoría actualizada.',
              ),
            );
          }}
        >
          <fieldset disabled={busy}>
            <legend>Nueva clasificación</legend>
            <p>
              <label htmlFor="doc-new-category">Nueva categoría</label>
              <select
                id="doc-new-category"
                required
                value={categoryId}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">Selecciona una categoría activa</option>
                {catalog
                  .filter((item) => item.id !== detail.categoryId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </p>
            <p>
              <label htmlFor="doc-category-reason">
                Motivo de clasificación
              </label>
              <select
                id="doc-category-reason"
                value={classificationReason}
                onChange={(event) =>
                  setClassificationReason(
                    event.target.value as ClassificationReason | '',
                  )
                }
              >
                <option value="">Sin motivo adicional</option>
                {Object.entries(reasons).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </p>
            <button type="submit" disabled={!categoryId}>
              Guardar categoría
            </button>
          </fieldset>
        </form>
      )}

      {form === 'association' && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (folio.trim()) searchDestinations(folio.trim(), 0);
            }}
          >
            <fieldset disabled={busy}>
              <legend>Buscar expediente de destino</legend>
              <p>
                <label htmlFor="doc-destination-folio">Folio de destino</label>
                <input
                  id="doc-destination-folio"
                  required
                  maxLength={40}
                  value={folio}
                  onChange={(event) => setFolio(event.target.value)}
                />
              </p>
              <button type="submit">Buscar destino</button>
            </fieldset>
          </form>
          {targets &&
            (targets.items.length ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!destinationId || !reason.trim()) return;
                  void run(async (signal) =>
                    onSaved(
                      (
                        await organizeDocument(
                          detail.id,
                          {
                            revision: detail.revision,
                            destinationId,
                            reason: reason.trim(),
                          },
                          signal,
                        )
                      ).id,
                      signal,
                      'Documento trasladado.',
                    ),
                  );
                }}
              >
                <fieldset disabled={busy}>
                  <legend>
                    Confirmar traslado desde{' '}
                    {detail.caseFolio ?? 'el expediente actual'}
                  </legend>
                  <p>
                    <label htmlFor="doc-destination">
                      Expediente de destino
                    </label>
                    <select
                      id="doc-destination"
                      required
                      value={destinationId}
                      onChange={(event) => setDestination(event.target.value)}
                    >
                      <option value="">Selecciona un expediente</option>
                      {targets.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.folio}
                        </option>
                      ))}
                    </select>
                  </p>
                  <p>
                    <label htmlFor="doc-move-reason">Motivo del traslado</label>
                    <textarea
                      id="doc-move-reason"
                      required
                      maxLength={2000}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </p>
                  <button
                    type="submit"
                    disabled={!destinationId || !reason.trim()}
                  >
                    Confirmar traslado
                  </button>
                </fieldset>
              </form>
            ) : (
              <p>No hay destinos autorizados para ese folio.</p>
            ))}
          {targets && (targets.offset > 0 || targets.hasMore) && (
            <div className="actions">
              <button
                type="button"
                className="button-secondary"
                disabled={busy || !targets.offset}
                onClick={() =>
                  searchDestinations(
                    query,
                    Math.max(0, targets.offset - targets.limit),
                  )
                }
              >
                Destinos anteriores
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={busy || !targets.hasMore}
                onClick={() =>
                  searchDestinations(query, targets.offset + targets.limit)
                }
              >
                Destinos siguientes
              </button>
            </div>
          )}
        </>
      )}
      {form && (
        <div className="actions">
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={() => setForm(null)}
          >
            Cancelar
          </button>
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={onRefresh}
          >
            Actualizar ficha
          </button>
        </div>
      )}

      {review && (
        <DocumentReview
          key={review.versionId}
          documentId={detail.id}
          workspace={review}
          busy={busy}
          run={run}
          onClose={() => setReview(null)}
          onWorkspaceChange={setReview}
          onRefreshDocument={onRefresh}
          onChanged={(signal, status) =>
            onSaved(
              detail.id,
              signal,
              `Estado actualizado a ${documentStateLabels[status]}.`,
            )
          }
        />
      )}
      {(detail.canUploadVersion || detail.canViewVersions) && (
        <DocumentVersions
          detail={detail}
          busy={busy}
          run={run}
          onPublished={(signal) =>
            onSaved(detail.id, signal, 'La nueva versión quedó vigente.')
          }
          onRefresh={onRefresh}
          onDownload={onDownload}
          onOpenReview={openReview}
        />
      )}
      {detail.classifications.length > 0 && (
        <details>
          <summary>Historial de clasificación</summary>
          <ul>
            {detail.classifications.map((item) => (
              <li key={item.id}>
                {item.previous} → {item.category} · {item.author} ·{' '}
                {documentDate(item.at)}
                {item.reason && (
                  <p>
                    {reasons[item.reason as ClassificationReason] ??
                      item.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {detail.associations.length > 0 && (
        <details>
          <summary>Historial de expedientes asociados</summary>
          <ul>
            {detail.associations.map((item) => (
              <li key={item.id}>
                {item.hasSource
                  ? `${item.sourceFolio ?? 'Origen restringido'} → `
                  : 'Asociación inicial: '}
                {item.destinationFolio ?? 'Destino restringido'} · {item.author}{' '}
                · {documentDate(item.at)}
                {item.reason && <p>{item.reason}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
