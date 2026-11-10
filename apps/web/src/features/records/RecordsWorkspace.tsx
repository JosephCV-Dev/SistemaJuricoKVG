import { CaseDetailView } from './CaseDetailView';
import { showDate } from './record-format';
import type { WorkspaceView } from '../../shared/navigation';
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

export function RecordsWorkspace({
  onSessionExpired,
  view,
  onNavigate,
  onCapabilities,
}: {
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  onCapabilities: (capabilities: SessionCapabilities['capabilities']) => void;
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
      onCapabilities(result.capabilities);
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
    onNavigate('client');
  }
  async function onCaseCreated(created: CaseSummary, signal: AbortSignal) {
    setNotice(`Expediente creado con folio ${created.folio}, en estado NUEVO.`);
    setCaseDetail(await getCase(created.id, signal));
    setCases(await searchCases('', '', 0, signal));
    setCaseText('');
    setCaseStatus('');
    setCaseQuery({ text: '', status: '' });
    onNavigate('case');
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
      onNavigate('client');
    });
  }
  function openCase(id: string) {
    void run(async (signal) => {
      setCaseDetail(null);
      setCaseDetail(await getCase(id, signal));
      onNavigate('case');
    });
  }

  return (
    <section aria-labelledby="records-heading" aria-busy={busy}>
      <h2 id="records-heading" className="sr-only">
        Área de trabajo
      </h2>
      {view === 'home' && (
        <section className="home-grid">
          <div className="panel">
            <h2>Acciones rápidas</h2>
            <p className="sub">Selecciona una tarea para comenzar.</p>
            <div className="actions">
              {can('cliente.registrar') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onNavigate('new-client')}
                >
                  Nuevo cliente
                </button>
              )}
              {can('cliente.consultar') && (
                <button
                  className="button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => onNavigate('clients')}
                >
                  Consultar clientes
                </button>
              )}
              {can('expediente.consultar') && (
                <button
                  className="button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => onNavigate('cases')}
                >
                  Consultar expedientes
                </button>
              )}
            </div>
          </div>
          <div className="panel">
            <h2>Tu espacio de trabajo</h2>
            <p>
              Los clientes y expedientes disponibles dependen de tus permisos y
              asignaciones vigentes.
            </p>
            <button
              className="button-secondary"
              type="button"
              onClick={() => onNavigate('session')}
            >
              Consultar mi sesión
            </button>
          </div>
        </section>
      )}
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

      {view === 'new-client' && can('cliente.registrar') && (
        <>
          <button
            className="breadcrumb"
            type="button"
            disabled={busy}
            onClick={() => onNavigate('clients')}
          >
            Clientes / Volver al listado
          </button>
          <ClientRegistration
            types={types}
            busy={busy}
            run={run}
            onCreated={onClientCreated}
          />
        </>
      )}

      {['clients', 'client'].includes(view) && can('cliente.consultar') && (
        <section className="panel" aria-labelledby="clients-heading">
          <div className="section-header">
            <h2 id="clients-heading">
              {view === 'client'
                ? (client?.name ?? 'Detalle del cliente')
                : 'Clientes'}
            </h2>
            <div className="actions">
              {view === 'clients' && can('cliente.registrar') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onNavigate('new-client')}
                >
                  Nuevo cliente
                </button>
              )}
              {view === 'client' && (
                <button
                  className="button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => onNavigate('clients')}
                >
                  Volver a clientes
                </button>
              )}
              {view === 'client' && client && can('expediente.crear') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onNavigate('new-case')}
                >
                  Crear expediente
                </button>
              )}
            </div>
          </div>
          <div hidden={view !== 'clients'}>
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
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Clientes disponibles</caption>
                  <thead>
                    <tr>
                      <th scope="col">Nombre</th>
                      <th scope="col">Tipo</th>
                      <th scope="col">Registrado</th>
                      <th scope="col">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>
                          {item.type === 'PERSONA_FISICA'
                            ? 'Persona física'
                            : item.type}
                        </td>
                        <td>{showDate(item.createdAt)}</td>
                        <td>
                          <button
                            className="table-link"
                            type="button"
                            disabled={busy}
                            onClick={() => openClient(item.id)}
                            aria-label={`Consultar cliente ${item.name}`}
                          >
                            Consultar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
          </div>
          {view === 'client' && client && (
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

      {view === 'new-case' && client && can('expediente.crear') && (
        <>
          <button
            className="breadcrumb"
            type="button"
            disabled={busy}
            onClick={() => onNavigate('client')}
          >
            Cliente / Volver al detalle
          </button>
          <CaseCreation
            key={client.id}
            client={client}
            busy={busy}
            run={run}
            onCreated={onCaseCreated}
            setError={setError}
          />
        </>
      )}

      {['cases', 'case'].includes(view) && can('expediente.consultar') && (
        <section className="panel" aria-labelledby="cases-heading">
          <div className="section-header">
            <h2 id="cases-heading">
              {view === 'case'
                ? (caseDetail?.folio ?? 'Detalle del expediente')
                : 'Expedientes'}
            </h2>
            <div className="actions">
              {view === 'case' && (
                <button
                  className="button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => onNavigate('cases')}
                >
                  Volver a expedientes
                </button>
              )}
              {view === 'cases' && can('expediente.crear') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onNavigate('clients');
                    setNotice(
                      'Selecciona un cliente para crear su expediente.',
                    );
                  }}
                >
                  Nuevo expediente
                </button>
              )}
            </div>
          </div>
          <div hidden={view !== 'cases'}>
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
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Expedientes disponibles</caption>
                  <thead>
                    <tr>
                      <th scope="col">Folio</th>
                      <th scope="col">Asunto</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <button
                            className="table-link"
                            type="button"
                            disabled={busy}
                            onClick={() => openCase(item.id)}
                            aria-label={`Consultar expediente ${item.folio}`}
                          >
                            {item.folio}
                          </button>
                        </td>
                        <td>{item.description.slice(0, 120)}</td>
                        <td>
                          <span className="badge">
                            {item.status.replaceAll('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="actions">
              <button
                className="button-secondary"
                type="button"
                disabled={busy || cases.offset === 0}
                onClick={() =>
                  loadCases(Math.max(0, cases.offset - cases.limit))
                }
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
          </div>
          {view === 'case' && caseDetail && (
            <CaseDetailView
              key={caseDetail.id}
              caseDetail={caseDetail}
              busy={busy}
              canConsultClient={can('cliente.consultar')}
              onOpenClient={openClient}
              canConsultDocuments={can('documento.consultar')}
              canUploadDocuments={can('documento.cargar')}
              canDownloadDocuments={can('documento.descargar')}
              onAccessFailure={(status) => {
                setClient(null);
                setCaseDetail(null);
                setClients(emptyPage());
                setCases(emptyPage());
                if (status === 401) onSessionExpired();
                else
                  setError(
                    'Acceso documental denegado. Actualiza tus consultas.',
                  );
              }}
            />
          )}
        </section>
      )}
    </section>
  );
}
