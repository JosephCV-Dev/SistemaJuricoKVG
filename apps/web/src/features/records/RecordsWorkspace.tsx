import { AuditWorkspace } from '../administration/AuditWorkspace';
import { ConfigurationWorkspace } from '../administration/ConfigurationWorkspace';
import { DocumentSearch } from '../documents/DocumentSearch';
import { AssignedCases } from './AssignedCases';
import { CaseAssignmentPanel } from './CaseAssignmentPanel';
import { CaseReassignmentWorkspace } from './CaseReassignmentWorkspace';
import { DocumentRecovery } from '../documents/DocumentRecovery';
import { CaseStaffAccessPanel } from '../identity/CaseStaffAccessPanel';
import { StaffWorkspace } from '../identity/StaffWorkspace';
import { CaseDetailView } from './CaseDetailView';
import { showDate } from './record-format';
import type { WorkspaceView } from '../../shared/navigation';
import { ClientEditor } from './ClientEditor';
import { ClientRegistration } from './ClientRegistration';
import { CaseCreation } from './CaseCreation';
import { useEffect, useRef, useState } from 'react';
import type {
  CaseDetail,
  CaseSummary,
  CaseStateChangeInput,
  CaseUpdateInput,
  ClientDetail,
  ClientSummary,
  ClientUpdateInput,
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
  updateClient,
  updateCase,
  changeCaseState,
  addCaseProgress,
} from './records-api';

const emptyPage = <T,>(): RecordPage<T> => ({
  items: [],
  limit: 20,
  offset: 0,
  hasMore: false,
});

const emptyCaseQuery = { text: '', status: '', client: '', responsible: '' };

export function RecordsWorkspace({
  onSessionExpired,
  view,
  onNavigate,
  onCapabilities,
  isLawyer,
  currentUserId,
}: {
  view: WorkspaceView;
  isLawyer: boolean;
  currentUserId: string;
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
  const [showAssignment, setShowAssignment] = useState(false);
  const [caseReturn, setCaseReturn] = useState<'cases' | 'assigned'>('cases');
  const [accessRevision, setAccessRevision] = useState(0);
  const [deniedAdministration, setDeniedAdministration] =
    useState<WorkspaceView | null>(null);
  const [clientText, setClientText] = useState('');
  const [clientIdentification, setClientIdentification] = useState('');
  const [clientQuery, setClientQuery] = useState({
    text: '',
    identification: '',
  });
  const [editTypes, setEditTypes] = useState<IdentificationType[] | null>(null);
  const [caseText, setCaseText] = useState('');
  const [caseStatus, setCaseStatus] = useState('');
  const [caseClient, setCaseClient] = useState('');
  const [caseResponsible, setCaseResponsible] = useState('');
  const [caseQuery, setCaseQuery] = useState(emptyCaseQuery);
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
      if (view === deniedAdministration) setDeniedAdministration(null);
    } catch (failure: unknown) {
      if (!controller.signal.aborted) {
        if (
          failure instanceof AuthRequestError &&
          [401, 403].includes(failure.status)
        ) {
          setClient(null);
          setEditTypes(null);
          setCaseDetail(null);
          setShowAssignment(false);
          if (
            view === 'assigned' ||
            view === 'reassign' ||
            view === 'documents' ||
            view === 'retired-documents' ||
            view === 'staff' ||
            view === 'audit' ||
            view === 'configuration'
          )
            setAccessRevision((previous) => previous + 1);
          if (view === 'audit' || view === 'configuration')
            setDeniedAdministration(view);
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
          (item) => item.permission === 'cliente.consultar',
        )
      )
        setClients(await searchClients('', 0, signal));
      if (
        result.capabilities.some(
          (item) => item.permission === 'expediente.consultar',
        )
      )
        setCases(await searchCases(emptyCaseQuery, 0, signal));
    });
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, []);

  function openClientRegistration() {
    void run(async (signal) => {
      setTypes(await getIdentificationTypes(signal));
      onNavigate('new-client');
    });
  }

  async function onClientCreated(created: ClientSummary, signal: AbortSignal) {
    setNotice(`Cliente registrado: ${created.name}.`);
    setClient(await getClient(created.id, signal));
    setClients(await searchClients('', 0, signal));
    setClientText('');
    setClientIdentification('');
    setClientQuery({ text: '', identification: '' });
    onNavigate('client');
  }
  async function onCaseCreated(created: CaseSummary, signal: AbortSignal) {
    setNotice(`Expediente creado con folio ${created.folio}, en estado NUEVO.`);
    setCaseDetail(await getCase(created.id, signal));
    setCaseReturn('cases');
    setShowAssignment(false);
    setCases(await searchCases(emptyCaseQuery, 0, signal));
    setCaseText('');
    setCaseStatus('');
    setCaseClient('');
    setCaseResponsible('');
    setCaseQuery(emptyCaseQuery);
    onNavigate('case');
  }
  function loadClients(offset: number, query = clientQuery) {
    void run(async (signal) => {
      setClient(null);
      setClients(emptyPage());
      setClients(
        await searchClients(query.text, offset, signal, query.identification),
      );
      setClientQuery(query);
    });
  }
  function loadCases(offset: number, query = caseQuery) {
    void run(async (signal) => {
      setCaseDetail(null);
      setCases(emptyPage());
      setCases(await searchCases(query, offset, signal));
      setCaseQuery(query);
    });
  }
  function openClient(id: string) {
    void run(async (signal) => {
      setClient(null);
      setEditTypes(null);
      setClient(await getClient(id, signal));
      onNavigate('client');
    });
  }
  function openClientEditor(current: ClientDetail) {
    void run(async (signal) => {
      setEditTypes(await getIdentificationTypes(signal, current.id));
    });
  }
  function saveClient(current: ClientDetail, input: ClientUpdateInput) {
    void run(async (signal) => {
      await updateClient(current.id, input, signal);
      setEditTypes(null);
      setClient(null);
      setClients(emptyPage());
      setNotice('Cliente actualizado.');
      setClient(await getClient(current.id, signal));
      setClients(
        await searchClients(
          clientQuery.text,
          0,
          signal,
          clientQuery.identification,
        ),
      );
    });
  }
  function saveCase(current: CaseDetail, input: CaseUpdateInput) {
    void run(async (signal) => {
      await updateCase(current.id, input, signal);
      setCaseDetail(null);
      setCases(emptyPage());
      setNotice('Expediente actualizado.');
      setCaseDetail(await getCase(current.id, signal));
      setCases(await searchCases(caseQuery, 0, signal));
    });
  }

  function saveCaseState(current: CaseDetail, input: CaseStateChangeInput) {
    void run(async (signal) => {
      await changeCaseState(current.id, input, signal);
      setCaseDetail(null);
      setCases(emptyPage());
      setNotice('Estado actualizado.');
      setCaseDetail(await getCase(current.id, signal));
      setCases(await searchCases(caseQuery, 0, signal));
    });
  }

  function openCase(id: string, back = caseReturn) {
    void run(async (signal) => {
      setCaseDetail(null);
      setCaseDetail(await getCase(id, signal));
      setCaseReturn(back);
      setShowAssignment(false);
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
                  onClick={openClientRegistration}
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
            'expediente.reasignar',
            'documento.consultar',
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
                  onClick={openClientRegistration}
                >
                  Nuevo cliente
                </button>
              )}
              {view === 'client' && (
                <button
                  className="button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditTypes(null);
                    onNavigate('clients');
                  }}
                >
                  Volver a clientes
                </button>
              )}
              {view === 'client' &&
                client &&
                !editTypes &&
                can('expediente.crear') && (
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
                loadClients(0, {
                  text: clientText.trim(),
                  identification: clientIdentification.trim(),
                });
              }}
            >
              <fieldset disabled={busy}>
                <legend>Filtros de clientes</legend>
                <p>
                  <label htmlFor="client-search">Nombre del cliente</label>
                  <input
                    id="client-search"
                    value={clientText}
                    onChange={(event) => setClientText(event.target.value)}
                    maxLength={200}
                  />
                </p>
                <p>
                  <label htmlFor="client-search-identification">
                    Identificación
                  </label>
                  <input
                    id="client-search-identification"
                    value={clientIdentification}
                    onChange={(event) =>
                      setClientIdentification(event.target.value)
                    }
                    maxLength={100}
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
          {view === 'client' && client && editTypes && (
            <ClientEditor
              key={`${client.id}:${client.revision}`}
              client={client}
              types={editTypes}
              busy={busy}
              onCancel={() => setEditTypes(null)}
              onSave={(input) => saveClient(client, input)}
              onReload={() => openClient(client.id)}
            />
          )}
          {view === 'client' && client && !editTypes && (
            <div className="record-detail">
              <h4>Cliente: {client.name}</h4>
              <dl>
                <dt>Identificador</dt>
                <dd>{client.id}</dd>
                <dt>Registrado</dt>
                <dd>{showDate(client.createdAt)}</dd>
              </dl>
              {client.canEdit && can('cliente.actualizar') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openClientEditor(client)}
                >
                  Editar cliente
                </button>
              )}
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
                      {item.label ? ` · ${item.label}` : ''}
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

      {view === 'assigned' && isLawyer && can('expediente.consultar') && (
        <AssignedCases
          accessRevision={accessRevision}
          busy={busy}
          run={run}
          onOpen={(id) => openCase(id, 'assigned')}
        />
      )}
      {view === 'reassign' && can('expediente.reasignar') && (
        <CaseReassignmentWorkspace
          key={accessRevision}
          busy={busy}
          run={run}
          onSaved={() => setNotice('Expediente reasignado.')}
        />
      )}

      {view === 'documents' && can('documento.consultar') && (
        <DocumentSearch
          busy={busy}
          run={run}
          accessRevision={accessRevision}
          canDownload={can('documento.descargar')}
          onOpenCase={(id) => openCase(id, 'cases')}
          onNotice={setNotice}
        />
      )}
      {view === 'retired-documents' && can('documento.recuperar') && (
        <DocumentRecovery key={accessRevision} busy={busy} run={run} />
      )}
      {view === 'audit' && can('auditoria.consultar') && (
        <AuditWorkspace
          key={accessRevision}
          busy={busy}
          run={run}
          autoLoad={deniedAdministration !== view}
        />
      )}
      {view === 'configuration' && can('configuracion.administrar') && (
        <ConfigurationWorkspace
          key={accessRevision}
          busy={busy}
          run={run}
          onNotice={setNotice}
          autoLoad={deniedAdministration !== view}
        />
      )}
      {view === 'staff' &&
        (can('usuario.administrar') || can('usuario.permisos')) && (
          <StaffWorkspace
            key={accessRevision}
            currentUserId={currentUserId}
            canManage={can('usuario.administrar')}
            canPermissions={can('usuario.permisos')}
            busy={busy}
            run={run}
            onNotice={setNotice}
          />
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
                  onClick={() => {
                    setShowAssignment(false);
                    onNavigate(caseReturn);
                  }}
                >
                  {caseReturn === 'assigned'
                    ? 'Volver a mis expedientes'
                    : 'Volver a expedientes'}
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
                loadCases(0, {
                  text: caseText.trim(),
                  status: caseStatus,
                  client: caseClient.trim(),
                  responsible: caseResponsible.trim(),
                });
              }}
            >
              <fieldset disabled={busy}>
                <legend>Filtros de expedientes</legend>
                <p>
                  <label htmlFor="case-search">
                    Folio, referencia externa o descripción
                  </label>
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
                <p>
                  <label htmlFor="case-client-filter">Nombre del cliente</label>
                  <input
                    id="case-client-filter"
                    value={caseClient}
                    onChange={(event) => setCaseClient(event.target.value)}
                    maxLength={200}
                  />
                </p>
                <p>
                  <label htmlFor="case-responsible-filter">
                    Abogado principal
                  </label>
                  <input
                    id="case-responsible-filter"
                    value={caseResponsible}
                    onChange={(event) => setCaseResponsible(event.target.value)}
                    maxLength={200}
                  />
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
                            onClick={() => openCase(item.id, 'cases')}
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
          {view === 'case' &&
            caseDetail &&
            showAssignment &&
            caseDetail.canAssign &&
            can('expediente.asignar') && (
              <CaseAssignmentPanel
                key={caseDetail.id}
                id={caseDetail.id}
                busy={busy}
                run={run}
                onBack={() => setShowAssignment(false)}
                onSaved={async (signal) => {
                  setShowAssignment(false);
                  setNotice('Asignación registrada.');
                  setCaseDetail(await getCase(caseDetail.id, signal));
                }}
              />
            )}
          {view === 'case' && caseDetail && !showAssignment && (
            <CaseDetailView
              key={`${caseDetail.id}:${caseDetail.revision}`}
              caseDetail={caseDetail}
              busy={busy}
              canAssign={caseDetail.canAssign && can('expediente.asignar')}
              onAssign={() => setShowAssignment(true)}
              canEdit={can('expediente.actualizar') && caseDetail.canEdit}
              onSave={(input) => saveCase(caseDetail, input)}
              onReload={() => openCase(caseDetail.id)}
              run={run}
              onStateChange={(input) => saveCaseState(caseDetail, input)}
              saveProgress={async (input, signal) => {
                await addCaseProgress(caseDetail.id, input, signal);
              }}
              onProgressSaved={async (signal) => {
                setNotice('Avance registrado.');
                setCaseDetail(await getCase(caseDetail.id, signal));
              }}
              canConsultClient={
                can('cliente.consultar') && caseDetail.clientName !== null
              }
              onOpenClient={openClient}
              onOpenCase={(id) => openCase(id, caseReturn)}
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
          {view === 'case' &&
            caseDetail &&
            !showAssignment &&
            can('expediente.conceder') &&
            caseDetail.assignments.some(
              (assignment) =>
                assignment.active &&
                assignment.function === 'PRINCIPAL' &&
                assignment.userId === currentUserId,
            ) && (
              <CaseStaffAccessPanel
                key={caseDetail.id}
                caseId={caseDetail.id}
                busy={busy}
                run={run}
                onNotice={setNotice}
              />
            )}
        </section>
      )}
    </section>
  );
}
