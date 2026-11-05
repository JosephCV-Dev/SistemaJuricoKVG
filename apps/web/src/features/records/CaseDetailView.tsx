import { useState } from 'react';
import type { CaseDetail } from '@kvg/contracts';
import { showDate } from './record-format';

export function CaseDetailView({
  caseDetail,
  busy,
  canConsultClient,
  onOpenClient,
}: {
  caseDetail: CaseDetail;
  busy: boolean;
  canConsultClient: boolean;
  onOpenClient: (id: string) => void;
}) {
  const [section, setSection] = useState<'summary' | 'history' | 'progress'>(
    'summary',
  );
  return (
    <div className="record-detail">
      <h4>Expediente {caseDetail.folio}</h4>
      <div className="detail-tabs" aria-label="Secciones del expediente">
        {(['summary', 'history', 'progress'] as const).map((item) => (
          <button
            className="button-secondary"
            type="button"
            key={item}
            aria-pressed={section === item}
            onClick={() => setSection(item)}
          >
            {
              { summary: 'Resumen', history: 'Historial', progress: 'Avances' }[
                item
              ]
            }
          </button>
        ))}
      </div>
      <div hidden={section !== 'summary'}>
        <dl>
          <dt>Estado</dt>
          <dd>{caseDetail.status}</dd>
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
        <h4>Responsables</h4>
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
      </div>
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
