import { CaseDocuments } from '../documents/CaseDocuments';
import { useState } from 'react';
import type { CaseDetail, CaseUpdateInput } from '@kvg/contracts';
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
  canConsultClient,
  onOpenClient,
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
  canConsultClient: boolean;
  onOpenClient: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<
    'summary' | 'history' | 'progress' | 'documents'
  >('summary');
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
          <dd>{caseDetail.status}</dd>
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
        />
      )}
      <div hidden={section !== 'history'}>
        <h4>Historial de estados</h4>
        <ul>
          {caseDetail.history.map((item, index) => (
            <li key={index}>
              {item.to} · {showDate(item.at)} · {item.reason}
            </li>
          ))}
        </ul>
      </div>
      <div hidden={section !== 'progress'}>
        <h4>Avances</h4>
        {caseDetail.progress.length ? (
          <ul>
            {caseDetail.progress.map((item, index) => (
              <li key={index}>
                {showDate(item.at)}: {item.description}
              </li>
            ))}
          </ul>
        ) : (
          <p>Sin avances registrados.</p>
        )}
      </div>
    </div>
  );
}
