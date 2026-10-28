import { ClientRegistration } from './ClientRegistration';
import { CaseCreation } from './CaseCreation';
import { useEffect, useRef, useState } from 'react';
import type {
  CaseDetail,
  CaseSummary,
  ClientDetail,
  ClientSummary,
  IdentificationType,
  RecordPage,
  SessionCapabilities,
} from '@kvg/contracts';
import { AuthRequestError } from '../../shared/api/session-http';
import {
  getCapabilities,
  getCase,
  getClient,
  getIdentificationTypes,
  searchCases,
  searchClients,
} from './records-api';

const emptyPage = <T,>(): RecordPage<T> => ({
  items: [],
  limit: 20,
  offset: 0,
  hasMore: false,
});
const showDate = (date: string) =>
  new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeZone: 'America/Merida',
  }).format(new Date(date));

export function RecordsWorkspace({
  onSessionExpired,
}: {
  onSessionExpired: () => void;
}) {
  const [capabilities, setCapabilities] = useState<
    SessionCapabilities['capabilities']
  >([]);
  const [types, setTypes] = useState<IdentificationType[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const activeRequest = useRef<AbortController | null>(null);
  const [clients, setClients] = useState(emptyPage<ClientSummary>);
  const [cases, setCases] = useState(emptyPage<CaseSummary>);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [clientText, setClientText] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [caseText, setCaseText] = useState('');
  const [caseStatus, setCaseStatus] = useState('');
  const [caseQuery, setCaseQuery] = useState({ text: '', status: '' });
  const can = (permission: string) =>
    capabilities.some((item) => item.permission === permission);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action(controller.signal);
    } catch (failure: unknown) {
      if (!controller.signal.aborted) {
        if (
          failure instanceof AuthRequestError &&
          [401, 403].includes(failure.status)
        ) {
          setClient(null);
          setCaseDetail(null);
          setClients(emptyPage());
          setCases(emptyPage());
          if (failure.status === 401) onSessionExpired();
        }
        setError(
          failure instanceof Error
            ? failure.message
            : 'No se pudo completar la operación.',
        );
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    void run(async (signal) => {
      const result = await getCapabilities(signal);
      setCapabilities(result.capabilities);
      if (
        result.capabilities.some(
          (item) => item.permission === 'cliente.registrar',
        )
      )
        setTypes(await getIdentificationTypes(signal));
      if (
        result.capabilities.some(
          (item) => item.permission === 'cliente.consultar',
        )
      )
        setClients(await searchClients('', 0, signal));
      if (
        result.capabilities.some(
          (item) => item.permission === 'expediente.consultar',
        )
      )
        setCases(await searchCases('', '', 0, signal));
    });
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, []);

  async function onClientCreated(created: ClientSummary, signal: AbortSignal) {
    setNotice(`Cliente registrado: ${created.name}.`);
    setClient(await getClient(created.id, signal));
    setClients(await searchClients('', 0, signal));
    setClientText('');
    setClientQuery('');
  }
  async function onCaseCreated(created: CaseSummary, signal: AbortSignal) {
    setNotice(`Expediente creado con folio ${created.folio}, en estado NUEVO.`);
    setCaseDetail(await getCase(created.id, signal));
    setCases(await searchCases('', '', 0, signal));
    setCaseText('');
    setCaseStatus('');
    setCaseQuery({ text: '', status: '' });
  }
  function loadClients(offset: number, text = clientQuery) {
    void run(async (signal) => {
      setClient(null);
      setClients(emptyPage());
      setClients(await searchClients(text, offset, signal));
      setClientQuery(text);
    });
  }
  function loadCases(offset: number, query = caseQuery) {
    void run(async (signal) => {
      setCaseDetail(null);
      setCases(emptyPage());
      setCases(await searchCases(query.text, query.status, offset, signal));
      setCaseQuery(query);
    });
  }
  function openClient(id: string) {
    void run(async (signal) => {
      setClient(null);
      setClient(await getClient(id, signal));
    });
  }
  function openCase(id: string) {
    void run(async (signal) => {
      setCaseDetail(null);
      setCaseDetail(await getCase(id, signal));
    });
  }

  return (
    <section aria-labelledby="records-heading" aria-busy={busy}>
      <h2 id="records-heading">Clientes y expedientes</h2>
      <div role="status" aria-live="polite" aria-atomic="true">
        {busy && <p>Procesando solicitud…</p>}
        {notice && <p>{notice}</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      {!busy &&
        !capabilities.some((item) =>
          [
            'cliente.consultar',
            'cliente.registrar',
            'expediente.consultar',
          ].includes(item.permission),
        ) && (
          <p>
            Tu cuenta no tiene permisos para gestionar o consultar clientes y
            expedientes.
          </p>
        )}

      {can('cliente.registrar') && (
        <ClientRegistration
          types={types}
          busy={busy}
          run={run}
          onCreated={onClientCreated}
        />
      )}

      {can('cliente.consultar') && (
        <section className="panel" aria-labelledby="clients-heading">
          <h3 id="clients-heading">Consultar clientes</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              loadClients(0, clientText);
            }}
          >
            <fieldset disabled={busy}>
              <legend>Buscar por nombre</legend>
              <p>
                <label htmlFor="client-search">Nombre del cliente</label>
                <input
                  id="client-search"
                  value={clientText}
                  onChange={(event) => setClientText(event.target.value)}
                  maxLength={200}
                />
              </p>
              <button type="submit">Buscar clientes</button>
            </fieldset>
          </form>
          {!busy && clients.items.length === 0 && (
            <p>No hay clientes visibles que coincidan con la búsqueda.</p>
          )}
          {clients.items.length > 0 && (
            <ul className="record-list">
              {clients.items.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => openClient(item.id)}
                    aria-label={`Consultar cliente ${item.name}`}
                  >
                    Consultar
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="actions">
            <button
              className="button-secondary"
              type="button"
              disabled={busy || clients.offset === 0}
              onClick={() =>
                loadClients(Math.max(0, clients.offset - clients.limit))
              }
            >
              Clientes anteriores
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={busy || !clients.hasMore}
              onClick={() => loadClients(clients.offset + clients.limit)}
            >
              Clientes siguientes
            </button>
          </p>
          {client && (
            <div className="record-detail">
              <h4>Cliente: {client.name}</h4>
              <dl>
                <dt>Identificador</dt>
                <dd>{client.id}</dd>
                <dt>Registrado</dt>
                <dd>{showDate(client.createdAt)}</dd>
              </dl>
              <h4>Identificaciones</h4>
              {client.identifications.length ? (
                <ul>
                  {client.identifications.map((item, index) => (
                    <li key={index}>
                      {item.type}: {item.value}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Sin identificaciones registradas.</p>
              )}
              <h4>Contactos</h4>
              {client.contacts.length ? (
                <ul>
                  {client.contacts.map((item, index) => (
                    <li key={index}>
                      {item.type}: {item.value}
                      {item.preferred ? ' · Preferente' : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Sin contactos registrados.</p>
              )}
            </div>
          )}
        </section>
      )}

      {client && can('expediente.crear') && (
        <CaseCreation
          key={client.id}
          client={client}
          busy={busy}
          run={run}
          onCreated={onCaseCreated}
          setError={setError}
        />
      )}

      {can('expediente.consultar') && (
        <section className="panel" aria-labelledby="cases-heading">
          <h3 id="cases-heading">Consultar expedientes</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              loadCases(0, { text: caseText, status: caseStatus });
            }}
          >
            <fieldset disabled={busy}>
              <legend>Buscar por folio o descripción</legend>
              <p>
                <label htmlFor="case-search">Folio o descripción</label>
                <input
                  id="case-search"
                  value={caseText}
                  onChange={(event) => setCaseText(event.target.value)}
                  maxLength={200}
                />
              </p>
              <p>
                <label htmlFor="case-status">Estado</label>
                <select
                  id="case-status"
                  value={caseStatus}
                  onChange={(event) => setCaseStatus(event.target.value)}
                >
                  <option value="">Todos los estados</option>
                  {[
                    'NUEVO',
                    'EN_PROCESO',
                    'PENDIENTE',
                    'CONCLUIDO',
                    'ARCHIVADO',
                  ].map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
              </p>
              <button type="submit">Buscar expedientes</button>
            </fieldset>
          </form>
          {!busy && cases.items.length === 0 && (
            <p>No hay expedientes visibles que coincidan con la búsqueda.</p>
          )}
          {cases.items.length > 0 && (
            <ul className="record-list">
              {cases.items.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.folio} · {item.status}
                    <br />
                    {item.description.slice(0, 120)}
                  </span>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => openCase(item.id)}
                    aria-label={`Consultar expediente ${item.folio}`}
                  >
                    Consultar
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="actions">
            <button
              className="button-secondary"
              type="button"
              disabled={busy || cases.offset === 0}
              onClick={() => loadCases(Math.max(0, cases.offset - cases.limit))}
            >
              Expedientes anteriores
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={busy || !cases.hasMore}
              onClick={() => loadCases(cases.offset + cases.limit)}
            >
              Expedientes siguientes
            </button>
          </p>
          {caseDetail && (
            <div className="record-detail">
              <h4>Expediente {caseDetail.folio}</h4>
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
                <dd>
                  {caseDetail.externalAuthority ?? 'Sin autoridad externa'}
                </dd>
              </dl>
              {can('cliente.consultar') && (
                <p>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => openClient(caseDetail.clientId)}
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
              <h4>Historial de estados</h4>
              <ul>
                {caseDetail.history.map((item, index) => (
                  <li key={index}>
                    {item.to} · {showDate(item.at)} · {item.reason}
                  </li>
                ))}
              </ul>
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
          )}
        </section>
      )}
    </section>
  );
}
