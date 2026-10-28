import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  ClientInput,
  ClientSummary,
  IdentificationType,
} from '@kvg/contracts';
import { createClient, searchClients } from './records-api';

export function ClientRegistration({
  types,
  busy,
  run,
  onCreated,
}: {
  types: IdentificationType[];
  busy: boolean;
  run: (action: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  onCreated: (client: ClientSummary, signal: AbortSignal) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [identificationType, setIdentificationType] = useState('');
  const [identificationValue, setIdentificationValue] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [clientDraft, setClientDraft] = useState<ClientInput | null>(null);
  const [nameWarning, setNameWarning] = useState(false);
  function reviewClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async (signal) => {
      if (Boolean(identificationType) !== Boolean(identificationValue.trim()))
        throw new Error(
          'Selecciona el tipo y captura su identificación, o deja ambos vacíos.',
        );
      const matches = await searchClients(name.trim(), 0, signal);
      setNameWarning(
        matches.items.some(
          (item) =>
            item.name.trim().toLocaleLowerCase('es') ===
            name.trim().toLocaleLowerCase('es'),
        ),
      );
      const contacts: ClientInput['contacts'] = [];
      if (email.trim())
        contacts.push({ type: 'CORREO', value: email.trim(), preferred: true });
      if (phone.trim())
        contacts.push({
          type: 'TELEFONO',
          value: phone.trim(),
          preferred: true,
        });
      setClientDraft({
        requestId: crypto.randomUUID(),
        name: name.trim(),
        identifications: identificationType
          ? [{ type: identificationType, value: identificationValue.trim() }]
          : [],
        contacts,
      });
    });
  }
  function saveClient() {
    if (!clientDraft) return;
    void run(async (signal) => {
      const created = await createClient(clientDraft, signal);
      await onCreated(created, signal);
      setClientDraft(null);
      setName('');
      setIdentificationValue('');
      setIdentificationType('');
      setEmail('');
      setPhone('');
    });
  }
  return (
    <section className="panel" aria-labelledby="new-client-heading">
      <h3 id="new-client-heading">Registrar cliente</h3>
      <p>
        Tipo admitido: persona física. Captura únicamente los datos necesarios.
      </p>
      <form onSubmit={reviewClient}>
        <fieldset disabled={busy || clientDraft !== null}>
          <legend>Datos del cliente</legend>
          <p>
            <label htmlFor="client-name">Nombre completo</label>
            <input
              id="client-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              pattern=".*\S.*"
              required
            />
          </p>
          <p>
            <label htmlFor="client-id-type">
              Tipo de identificación (opcional)
            </label>
            <select
              id="client-id-type"
              value={identificationType}
              onChange={(event) => setIdentificationType(event.target.value)}
            >
              <option value="">Sin identificación</option>
              {types.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.name}
                  {type.unique ? ' (única)' : ''}
                </option>
              ))}
            </select>
          </p>
          <p>
            <label htmlFor="client-identification">
              Identificación (opcional)
            </label>
            <input
              id="client-identification"
              value={identificationValue}
              onChange={(event) => setIdentificationValue(event.target.value)}
              maxLength={100}
              required={Boolean(identificationType)}
            />
          </p>
          <p>
            <label htmlFor="client-email">Correo (opcional)</label>
            <input
              id="client-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
            />
          </p>
          <p>
            <label htmlFor="client-phone">Teléfono (opcional)</label>
            <input
              id="client-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              maxLength={32}
            />
          </p>
          <button type="submit">Revisar datos del cliente</button>
        </fieldset>
      </form>
      {clientDraft && (
        <div className="review">
          <h4>Confirmar registro</h4>
          <p>{clientDraft.name}</p>
          {clientDraft.identifications.map((item) => (
            <p key={item.type}>
              {item.type}: {item.value}
            </p>
          ))}
          {clientDraft.contacts.map((item) => (
            <p key={item.type}>
              {item.type}: {item.value}
            </p>
          ))}
          {nameWarning && (
            <p>
              Hay una coincidencia de nombre entre los clientes que puedes
              consultar. Revisa el listado antes de confirmar. El nombre por sí
              solo no impide el registro.
            </p>
          )}
          <p className="actions">
            <button type="button" onClick={saveClient} disabled={busy}>
              Confirmar registro de cliente
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => setClientDraft(null)}
              disabled={busy}
            >
              Editar datos del cliente
            </button>
          </p>
          <p>
            Si la respuesta se interrumpe, vuelve a confirmar conservando estos
            datos. Ante una identificación duplicada, busca el cliente entre tus
            resultados autorizados.
          </p>
        </div>
      )}
    </section>
  );
}
