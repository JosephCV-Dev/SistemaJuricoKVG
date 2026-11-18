import { Icon } from '../../shared/ui/Icon';
import { CaseDocuments } from '../documents/CaseDocuments';
import { type ReactNode, useState } from 'react';
import type {
  CaseDetail,
  CaseUpdateInput,
  CaseProgress,
  CaseProgressInput,
  CaseStateChangeInput,
} from '@kvg/contracts';
import { CaseProgressEditor } from './CaseProgressEditor';
import { CaseStatusEditor, statusLabel } from './CaseStatusEditor';
import type { RunRecordAction } from './CaseAssignmentPanel';
import { CaseEditor } from './CaseEditor';
import { showDate } from './record-format';

export function CaseDetailView({
  caseDetail,
  isLawyer,
  reviewFirst,
  staffAccess,
  busy,
  canEdit,
  canAssign,
  onAssign,
  onSave,
  onReload,
  run,
  onStateChange,
  onProgressSaved,
  saveProgress,
  canConsultClient,
  onOpenClient,
  onOpenCase,
  canConsultDocuments,
  canUploadDocuments,
  canDownloadDocuments,
  onAccessFailure,
}: {
  isLawyer: boolean;
  reviewFirst: boolean;
  staffAccess?: ReactNode;
  canConsultDocuments: boolean;
  canUploadDocuments: boolean;
  canDownloadDocuments: boolean;
  onAccessFailure: (status: number) => void;
  caseDetail: CaseDetail;
  busy: boolean;
  canEdit: boolean;
  canAssign: boolean;
  onAssign: () => void;
  onSave: (input: CaseUpdateInput) => void;
  onReload: () => void;
  run: RunRecordAction;
  onStateChange: (input: CaseStateChangeInput) => void;
  saveProgress: (
    input: CaseProgressInput,
    signal: AbortSignal,
  ) => Promise<void>;
  onProgressSaved: (signal: AbortSignal) => Promise<void>;
  canConsultClient: boolean;
  onOpenClient: (id: string) => void;
  onOpenCase: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [changingState, setChangingState] = useState(false);
  const [documentsOpened, setDocumentsOpened] = useState(false);
  const [progressDraft, setProgressDraft] = useState<{
    original: CaseProgress | null;
  } | null>(null);
  const [section, setSection] = useState<
    'summary' | 'history' | 'progress' | 'documents' | 'staff'
  >('summary');
  const sections = [
    'summary',
    ...(isLawyer ? ['progress' as const] : []),
    ...(canConsultDocuments ? ['documents' as const] : []),
    'staff',
    ...(!isLawyer ? ['progress' as const] : []),
    'history',
  ] as const;
  const sectionDetails = {
    summary: { label: 'Resumen', icon: 'summary' },
    history: { label: 'Historial', icon: 'history' },
    progress: { label: 'Avances', icon: 'progress' },
    documents: { label: 'Documentos', icon: 'file' },
    staff: { label: 'Responsables', icon: 'people' },
  } as const;
  const activeAssignments = caseDetail.assignments.filter(
    (item) => item.active,
  );
  const principal = activeAssignments.find(
    (item) => item.function === 'PRINCIPAL',
  );
  if (changingState && caseDetail.transitions.length) {
    return (
      <CaseStatusEditor
        detail={caseDetail}
        busy={busy}
        onSave={onStateChange}
        onReload={onReload}
        onCancel={() => setChangingState(false)}
      />
    );
  }
  if (editing && canEdit) {
    return (
      <CaseEditor
        caseDetail={caseDetail}
        busy={busy}
        onSave={onSave}
        onCancel={() => setEditing(false)}
        onReload={onReload}
      />
    );
  }
  return (
    <div>
      <div
        className="detail-tabs"
        role="group"
        aria-label="Secciones del expediente"
      >
        {sections.map((item) => (
          <button
            className="button-secondary"
            type="button"
            key={item}
            aria-pressed={section === item}
            onClick={() => {
              setSection(item);
              if (item === 'documents') setDocumentsOpened(true);
            }}
          >
            <Icon name={sectionDetails[item].icon} />
            {sectionDetails[item].label}
          </button>
        ))}
      </div>
      <div hidden={section !== 'summary'}>
        <dl>
          <dt>Estado</dt>
          <dd>{statusLabel[caseDetail.status]}</dd>
          {caseDetail.clientName && (
            <>
              <dt>Cliente principal</dt>
              <dd>{caseDetail.clientName}</dd>
            </>
          )}
          <dt>Abogado principal</dt>
          <dd>{principal?.name ?? 'Sin abogado principal asignado'}</dd>
          <dt>Descripción</dt>
          <dd>{caseDetail.description}</dd>
          <dt>Creado</dt>
          <dd>{showDate(caseDetail.createdAt)}</dd>
          <dt>Número externo</dt>
          <dd>{caseDetail.externalNumber ?? 'Sin número externo'}</dd>
          <dt>Autoridad</dt>
          <dd>{caseDetail.externalAuthority ?? 'Sin autoridad externa'}</dd>
        </dl>
        <div className="actions case-summary-actions">
          {canAssign && !caseDetail.hasActivePrincipal && (
            <button type="button" disabled={busy} onClick={onAssign}>
              <Icon name="people" />
              Asignar abogado
            </button>
          )}
          {caseDetail.transitions.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setChangingState(true)}
            >
              <Icon name="progress" />
              Cambiar estado
            </button>
          )}
          {canEdit && (
            <button
              className="button-secondary"
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              <Icon name="edit" />
              Editar expediente
            </button>
          )}
          {canConsultClient && (
            <button
              className="button-secondary"
              type="button"
              disabled={busy}
              onClick={() => onOpenClient(caseDetail.clientId)}
            >
              <Icon name="person" />
              Consultar cliente
            </button>
          )}
        </div>
        {caseDetail.status === 'NUEVO' && !caseDetail.hasActivePrincipal && (
          <p className="file-note">
            Para pasar a En proceso, asigna un abogado principal activo.
          </p>
        )}
      </div>
      <section
        hidden={section !== 'staff'}
        aria-label="Responsables del expediente"
      >
        <div className="section-header">
          <h2>Responsables vigentes</h2>
          {canAssign && (
            <button
              className="button-secondary"
              type="button"
              disabled={busy}
              onClick={onAssign}
            >
              <Icon name="people" />
              Asignar abogado
            </button>
          )}
        </div>
        {activeAssignments.length > 0 ? (
          <ul>
            {activeAssignments.map((item) => (
              <li key={item.userId + item.startsAt}>
                {item.function === 'PRINCIPAL' ? 'Principal' : 'Colaborador'} ·{' '}
                {item.name}
              </li>
            ))}
          </ul>
        ) : (
          <p>Sin abogado asignado.</p>
        )}
        {staffAccess}
      </section>
      {documentsOpened && canConsultDocuments && (
        <div hidden={section !== 'documents'}>
          <CaseDocuments
            key={caseDetail.id}
            caseId={caseDetail.id}
            canUpload={canUploadDocuments}
            canDownload={canDownloadDocuments}
            reviewFirst={reviewFirst}
            onAccessFailure={onAccessFailure}
            onOpenCase={onOpenCase}
          />
        </div>
      )}
      <div hidden={section !== 'history'}>
        <h2>Historial de estados</h2>
        {!caseDetail.history.length && (
          <p>Sin cambios de estado registrados.</p>
        )}
        <ul>
          {caseDetail.history.map((item, index) => (
            <li key={index}>
              {item.from
                ? `${statusLabel[item.from as keyof typeof statusLabel] ?? item.from} → `
                : ''}
              {statusLabel[item.to as keyof typeof statusLabel] ?? item.to} ·{' '}
              {showDate(item.at)}
              {item.authorName ? ` · ${item.authorName}` : ''}
              <p>{item.reason}</p>
              {item.approvalReference && (
                <p>Autorización: {item.approvalReference}</p>
              )}
            </li>
          ))}
        </ul>
        {caseDetail.assignments.some((item) => !item.active) && (
          <details>
            <summary>Historial de asignaciones</summary>
            <ul>
              {caseDetail.assignments
                .filter((item) => !item.active)
                .map((item) => (
                  <li key={item.userId + item.startsAt}>
                    {item.name} ·{' '}
                    {item.function === 'PRINCIPAL'
                      ? 'Principal'
                      : 'Colaborador'}{' '}
                    · {showDate(item.startsAt)}
                    {item.endsAt ? ` a ${showDate(item.endsAt)}` : ''}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>
      <div hidden={section !== 'progress'}>
        <div className="section-header">
          <h2>Avances del expediente</h2>
          {caseDetail.canAddProgress && !progressDraft && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setProgressDraft({ original: null })}
            >
              <Icon name="add" />
              Nuevo avance
            </button>
          )}
        </div>
        {section === 'progress' &&
          caseDetail.canAddProgress &&
          progressDraft && (
            <CaseProgressEditor
              key={progressDraft.original?.id ?? 'new'}
              caseId={caseDetail.id}
              original={progressDraft.original}
              busy={busy}
              run={run}
              onCancel={() => setProgressDraft(null)}
              onSave={(input) =>
                void run(async (signal) => {
                  await saveProgress(input, signal);
                  setProgressDraft(null);
                  await onProgressSaved(signal);
                })
              }
            />
          )}
        {caseDetail.progress.length ? (
          <ul>
            {caseDetail.progress.map((item) => {
              const original = caseDetail.progress.find(
                (entry) => entry.id === item.correctsId,
              );
              return (
                <li key={item.id}>
                  <p>
                    {showDate(item.at)}
                    {item.authorName ? ` · ${item.authorName}` : ''}
                  </p>
                  {item.correctsId && (
                    <p>
                      {original
                        ? `Corrección de la entrada del ${showDate(original.at)}`
                        : 'Corrección de un avance anterior'}
                      .
                    </p>
                  )}
                  <p>{item.description}</p>
                  {item.occurredOn && (
                    <p>Fecha del hecho: {item.occurredOn}.</p>
                  )}
                  {item.source && <p>Procedencia: {item.source}.</p>}
                  {item.references.length > 0 && (
                    <ul aria-label="Versiones vinculadas">
                      {item.references.map((ref) => (
                        <li key={ref.versionId}>
                          {ref.name} · v{ref.number}
                        </li>
                      ))}
                    </ul>
                  )}
                  {caseDetail.canAddProgress && !progressDraft && (
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy}
                      onClick={() => setProgressDraft({ original: item })}
                    >
                      Corregir este avance
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>Sin avances registrados.</p>
        )}
      </div>
    </div>
  );
}
