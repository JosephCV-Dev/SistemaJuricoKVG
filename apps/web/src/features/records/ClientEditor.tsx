import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  ClientDetail,
  ClientUpdateInput,
  IdentificationType,
} from '@kvg/contracts';

function replaceAt<T>(items: T[], index: number, value: T) {
  return items.map((item, position) => (position === index ? value : item));
}

export function ClientEditor({
  client,
  types,
  busy,
  onSave,
  onCancel,
  onReload,
}: {
  client: ClientDetail;
  types: IdentificationType[];
  busy: boolean;
  onSave: (input: ClientUpdateInput) => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [identifications, setIdentifications] = useState(
    client.identifications,
  );
  const [contacts, setContacts] = useState(client.contacts);
  const identificationTypes = [
    ...types,
    ...Array.from(new Set(client.identifications.map((item) => item.type)))
      .filter((code) => !types.some((item) => item.code === code))
      .map((code) => ({ code, name: `${code} (inactivo)`, unique: false })),
  ];

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: ClientUpdateInput = { revision: client.revision };
    if (name.trim() !== client.name) input.name = name.trim();
    if (
      JSON.stringify(identifications) !== JSON.stringify(client.identifications)
    )
      input.identifications = identifications;
    if (JSON.stringify(contacts) !== JSON.stringify(client.contacts))
      input.contacts = contacts;
    if (Object.keys(input).length > 1) onSave(input);
  }

  const changed =
    name.trim() !== client.name ||
    JSON.stringify(identifications) !==
      JSON.stringify(client.identifications) ||
    JSON.stringify(contacts) !== JSON.stringify(client.contacts);

  return (
    <form className="record-detail" onSubmit={save}>
      <h3>Editar cliente</h3>
      <p>Revisión {client.revision}</p>
      <fieldset disabled={busy}>
        <legend>Datos del cliente</legend>
        <label htmlFor="edit-client-name">Nombre completo</label>
        <input
          id="edit-client-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={200}
          pattern=".*\S.*"
        />
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Identificaciones</legend>
        {identifications.map((item, index) => (
          <fieldset key={index}>
            <legend>Identificación {index + 1}</legend>
            <label htmlFor={`edit-id-type-${index}`}>Tipo</label>
            <select
              id={`edit-id-type-${index}`}
              value={item.type}
              required
              onChange={(event) =>
                setIdentifications(
                  replaceAt(identifications, index, {
                    ...item,
                    type: event.target.value,
                  }),
                )
              }
            >
              <option value="">Selecciona un tipo</option>
              {identificationTypes.map((type) => (
                <option
                  key={type.code}
                  value={type.code}
                  disabled={
                    !types.some((active) => active.code === type.code) &&
                    type.code !== item.type
                  }
                >
                  {type.name}
                </option>
              ))}
            </select>
            <label htmlFor={`edit-id-value-${index}`}>Valor</label>
            <input
              id={`edit-id-value-${index}`}
              value={item.value}
              required
              maxLength={100}
              pattern=".*\S.*"
              onChange={(event) =>
                setIdentifications(
                  replaceAt(identifications, index, {
                    ...item,
                    value: event.target.value,
                  }),
                )
              }
            />
            <button
              className="button-secondary"
              type="button"
              aria-label={`Quitar identificación ${index + 1}`}
              onClick={() =>
                setIdentifications(
                  identifications.filter((_, position) => position !== index),
                )
              }
            >
              Quitar identificación
            </button>
          </fieldset>
        ))}
        <button
          className="button-secondary"
          type="button"
          disabled={identifications.length >= 20 || !types.length}
          onClick={() =>
            setIdentifications([...identifications, { type: '', value: '' }])
          }
        >
          Agregar identificación
        </button>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Contactos</legend>
        {contacts.map((item, index) => (
          <fieldset key={index}>
            <legend>Contacto {index + 1}</legend>
            <label htmlFor={`edit-contact-type-${index}`}>Tipo</label>
            <select
              id={`edit-contact-type-${index}`}
              value={item.type}
              onChange={(event) =>
                setContacts(
                  replaceAt(contacts, index, {
                    ...item,
                    type:
                      event.target.value === 'CORREO' ? 'CORREO' : 'TELEFONO',
                  }),
                )
              }
            >
              <option value="CORREO">Correo</option>
              <option value="TELEFONO">Teléfono</option>
            </select>
            <label htmlFor={`edit-contact-value-${index}`}>Valor</label>
            <input
              id={`edit-contact-value-${index}`}
              value={item.value}
              required
              type={item.type === 'CORREO' ? 'email' : 'tel'}
              maxLength={item.type === 'CORREO' ? 254 : 32}
              onChange={(event) =>
                setContacts(
                  replaceAt(contacts, index, {
                    ...item,
                    value: event.target.value,
                  }),
                )
              }
            />
            <label htmlFor={`edit-contact-label-${index}`}>
              Etiqueta (opcional)
            </label>
            <input
              id={`edit-contact-label-${index}`}
              value={item.label ?? ''}
              maxLength={80}
              onChange={(event) => {
                const { label: _label, ...contact } = item;
                const label = event.target.value;
                setContacts(
                  replaceAt(
                    contacts,
                    index,
                    label.trim() ? { ...contact, label } : contact,
                  ),
                );
              }}
            />
            <label>
              <input
                type="checkbox"
                checked={item.preferred}
                onChange={(event) =>
                  setContacts(
                    replaceAt(contacts, index, {
                      ...item,
                      preferred: event.target.checked,
                    }),
                  )
                }
              />
              Preferente
            </label>
            <button
              className="button-secondary"
              type="button"
              aria-label={`Quitar contacto ${index + 1}`}
              onClick={() =>
                setContacts(
                  contacts.filter((_, position) => position !== index),
                )
              }
            >
              Quitar contacto
            </button>
          </fieldset>
        ))}
        <button
          className="button-secondary"
          type="button"
          disabled={contacts.length >= 20}
          onClick={() =>
            setContacts([
              ...contacts,
              { type: 'CORREO', value: '', preferred: false },
            ])
          }
        >
          Agregar contacto
        </button>
      </fieldset>
      <p className="actions">
        <button type="submit" disabled={busy || !changed}>
          Confirmar cambios
        </button>
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={onReload}
        >
          Descartar cambios y consultar datos vigentes
        </button>
      </p>
    </form>
  );
}
