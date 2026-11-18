import { CaseDocuments } from '../documents/CaseDocuments';
import { useState } from 'react';
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
  const [progressDraft, setProgressDraft] = useState<{
    original: CaseProgress | null;
  } | null>(null);
  const [section, setSection] = useState<
    'summary' | 'history' | 'progress' | 'documents'
  >('summary');
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
    <div className="record-detail">
      <h4>Expediente {caseDetail.folio}</h4>
      <div className="detail-tabs" aria-label="Secciones del expediente">
        {(
          [
            'summary',
            ...(canConsultDocuments ? ['documents' as const] : []),
            'history',
            'progress',
          ] as const
        ).map((item) => (
          <button
            className="button-secondary"
            type="button"
            key={item}
            aria-pressed={section === item}
            onClick={() => setSection(item)}
          >
            {
              {
                summary: 'Resumen',
                history: 'Historial',
                progress: 'Avances',
                documents: 'Documentos',
              }[item]
            }
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
          <dt>Descripción</dt>
          <dd>{caseDetail.description}</dd>
          <dt>Creado</dt>
          <dd>{showDate(caseDetail.createdAt)}</dd>
          <dt>Número externo</dt>
          <dd>{caseDetail.externalNumber ?? 'Sin número externo'}</dd>
          <dt>Autoridad</dt>
          <dd>{caseDetail.externalAuthority ?? 'Sin autoridad externa'}</dd>
        </dl>
        {canConsultClient && (
          <p>
            <button
              className="button-secondary"
              type="button"
              disabled={busy}
              onClick={() => onOpenClient(caseDetail.clientId)}
            >
              Consultar cliente asociado
            </button>
          </p>
        )}
        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Editar expediente
          </button>
        )}
        {canAssign && (
          <button type="button" disabled={busy} onClick={onAssign}>
            Asignar abogado
          </button>
        )}
        {caseDetail.transitions.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setChangingState(true)}
          >
            Cambiar estado
          </button>
        )}
        {caseDetail.status === 'NUEVO' && !caseDetail.hasActivePrincipal && (
          <p>Para pasar a En proceso, asigna un abogado principal activo.</p>
        )}
        <h4>Responsables vigentes</h4>
        {caseDetail.assignments.filter((item) => item.active).length ? (
          <ul>
            {caseDetail.assignments
              .filter((item) => item.active)
              .map((item, index) => (
                <li key={index}>
                  {item.function}: {item.name}
                </li>
              ))}
          </ul>
        ) : (
          <p>Sin abogado asignado.</p>
        )}
        {caseDetail.assignments.some((item) => !item.active) && (
          <details>
            <summary>Historial de asignaciones</summary>
            <ul>
              {caseDetail.assignments
                .filter((item) => !item.active)
                .map((item, index) => (
                  <li key={index}>
                    {item.name} · {item.function} · {showDate(item.startsAt)}
                    {item.endsAt ? ` a ${showDate(item.endsAt)}` : ''}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>
      {section === 'documents' && canConsultDocuments && (
        <CaseDocuments
          key={caseDetail.id}
          caseId={caseDetail.id}
          canUpload={canUploadDocuments}
          canDownload={canDownloadDocuments}
          onAccessFailure={onAccessFailure}
          onOpenCase={onOpenCase}
        />
      )}
      <div hidden={section !== 'history'}>
        <h4>Historial de estados</h4>
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
      </div>
      <div hidden={section !== 'progress'}>
        <h4>Avances</h4>
        {caseDetail.canAddProgress && !progressDraft && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setProgressDraft({ original: null })}
          >
            Nuevo avance
          </button>
        )}
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
