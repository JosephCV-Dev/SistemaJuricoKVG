import { Icon } from '../../shared/ui/Icon';
import { useEffect, useId, useRef, useState } from 'react';
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
import {
  documentStateLabel,
  documentStateLabels,
  fileSizeLabel,
} from './document-format';

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
  reviewFirst,
  onBack,
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
  reviewFirst: boolean;
  onBack: () => void;
  run: RunDocumentAction;
  onSaved: (id: string, signal: AbortSignal, message: string) => Promise<void>;
  onRefresh: () => void;
  onDownload: () => void;
  onOpenCase?: (id: string) => void;
  onRetired: (id: string, signal: AbortSignal) => Promise<void>;
}) {
  const title = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewPanel = useRef<HTMLElement>(null);
  const [section, setSection] = useState<
    'summary' | 'review' | 'versions' | 'manage'
  >('summary');
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
  const reviewLabel = reviewFirst
    ? 'Revisión y estado'
    : 'Estado del documento';
  const canManage =
    detail.canClassify ||
    detail.canAssociate ||
    detail.canEditName ||
    detail.canRetire ||
    detail.classifications.length > 0 ||
    detail.associations.length > 0;
  const canUseVersions = detail.canViewVersions || detail.canUploadVersion;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  function openReview(versionId: string) {
    setSection('review');
    requestAnimationFrame(() => reviewPanel.current?.focus());
    if (review?.versionId === versionId) return;
    setReview(null);
    void run(async (signal) => {
      setReview(await documentVersionReview(detail.id, versionId, 0, signal));
    });
  }

  const summaryTab = {
    key: 'summary',
    icon: 'summary' as const,
    label: 'Ficha',
    open: () => setSection('summary'),
  };
  const reviewTab =
    original && detail.fileAvailable
      ? {
          key: 'review',
          icon: 'review' as const,
          label: reviewLabel,
          open: () => openReview(original.id),
        }
      : null;
  const versionsTab = canUseVersions
    ? {
        key: 'versions',
        icon: 'history' as const,
        label: 'Versiones',
        open: () => setSection('versions'),
      }
    : null;
  const manageTab = canManage
    ? {
        key: 'manage',
        icon: 'settings' as const,
        label: 'Gestión documental',
        open: () => setSection('manage'),
      }
    : null;
  const sections = reviewFirst
    ? [summaryTab, reviewTab, versionsTab, manageTab]
    : [summaryTab, manageTab, versionsTab, reviewTab];
  function searchDestinations(term: string, offset: number) {
    setTargets(null);
    setDestination('');
    void run(async (signal) => {
      setTargets(await documentDestinations(detail.id, term, offset, signal));
      setQuery(term);
    });
  }

  return (
    <section className="document-workspace" aria-labelledby={title}>
      <div className="section-header">
        <div>
          <p className="sub document-context">
            Documento{detail.caseFolio && <> · {detail.caseFolio}</>}
          </p>
          <h2
            className="workspace-title visual-heading"
            id={title}
            tabIndex={-1}
            ref={heading}
          >
            <Icon name="file" />
            <span>{detail.name}</span>
          </h2>
        </div>
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={onBack}
        >
          <Icon name="back" />
          Volver a documentos
        </button>
      </div>
      <p className="document-summary">
        <span className="badge">
          {original
            ? documentStateLabel(original.status)
            : 'Sin versión habilitada'}
        </span>
        <span>{detail.categoryName}</span>
        {original && <span>Versión {original.number}</span>}
      </p>
      {original?.beta && (
        <p className="file-note">Archivo beta sin análisis antimalware.</p>
      )}
      {original && !detail.fileAvailable && (
        <p className="file-note">Archivo no disponible.</p>
      )}
      <div className="actions document-primary">
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
            <Icon name="download" />
            Descargar original
          </button>
        )}
        {detail.caseFolio && onOpenCase && (
          <button
            className="button-secondary"
            type="button"
            disabled={busy}
            onClick={() => onOpenCase(detail.caseId)}
          >
            <Icon name="folder" />
            Abrir expediente asociado
          </button>
        )}
      </div>
      <div
        className="detail-tabs"
        role="group"
        aria-label="Secciones del documento"
      >
        {sections.map(
          (item) =>
            item && (
              <button
                className="button-secondary"
                type="button"
                key={item.key}
                aria-pressed={section === item.key}
                disabled={busy}
                onClick={item.open}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            ),
        )}
      </div>

      <section hidden={section !== 'summary'} aria-label="Datos del documento">
        <dl>
          <dt>Registrado</dt>
          <dd>{documentDate(detail.createdAt)}</dd>
          <dt>Registrado por</dt>
          <dd>{detail.authorName}</dd>
          {original && (
            <>
              <dt>Archivo</dt>
              <dd>
                {original.format} · {fileSizeLabel(original.size)}
              </dd>
              <dt>Última versión publicada</dt>
              <dd>{documentDate(original.publishedAt)}</dd>
            </>
          )}
        </dl>
      </section>

      <section
        className="document-management"
        hidden={section !== 'manage'}
        aria-label="Gestión documental"
      >
        <div className="actions">
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
              <Icon name="settings" />
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
              <Icon name="transfer" />
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
              <Icon name="edit" />
              Cambiar nombre
            </button>
          )}
          {detail.canRetire && !form && (
            <button
              className="button-secondary button-danger"
              type="button"
              disabled={busy}
              onClick={() => setForm('retire')}
            >
              <Icon name="archive" />
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
              <legend>Cambiar nombre del documento</legend>
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
                  <label htmlFor="doc-destination-folio">
                    Folio de destino
                  </label>
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
                      <label htmlFor="doc-move-reason">
                        Motivo del traslado
                      </label>
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
                  {item.destinationFolio ?? 'Destino restringido'} ·{' '}
                  {item.author} · {documentDate(item.at)}
                  {item.reason && <p>{item.reason}</p>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section
        hidden={section !== 'review'}
        aria-label={reviewLabel}
        tabIndex={-1}
        ref={reviewPanel}
      >
        {!review && busy && (
          <p role="status">Consultando el estado de la versión…</p>
        )}
        {!review && !busy && original && (
          <button
            type="button"
            className="button-secondary"
            onClick={() => openReview(original.id)}
          >
            Consultar estado
          </button>
        )}
        {review && (
          <DocumentReview
            key={review.versionId}
            documentId={detail.id}
            workspace={review}
            reviewFirst={reviewFirst}
            busy={busy}
            run={run}
            onClose={() => setSection('summary')}
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
      </section>
      {canUseVersions && (
        <section hidden={section !== 'versions'} aria-label="Versiones">
          <DocumentVersions
            detail={detail}
            active={section === 'versions'}
            reviewFirst={reviewFirst}
            busy={busy}
            run={run}
            onPublished={(signal) =>
              onSaved(detail.id, signal, 'La nueva versión quedó vigente.')
            }
            onRefresh={onRefresh}
            onDownload={onDownload}
            onOpenReview={openReview}
          />
        </section>
      )}
    </section>
  );
}
