import type { ClientDetail } from '@kvg/contracts';
import { showDate } from './record-format';

const contactLabels = {
  CORREO: 'Correo electrónico',
  TELEFONO: 'Teléfono',
};

export function ClientOverview({ client }: { client: ClientDetail }) {
  return (
    <>
      <p className="client-profile-meta">
        <span>
          {client.type === 'PERSONA_FISICA'
            ? 'Persona física'
            : client.type.replaceAll('_', ' ')}
        </span>
        <span>Alta: {showDate(client.createdAt)}</span>
      </p>
      {!client.contacts.length && !client.identifications.length ? (
        <p className="file-note">
          Este cliente aún no tiene datos de contacto ni identificaciones
          registrados.
        </p>
      ) : (
        <div className="client-profile-grid">
          {client.contacts.length > 0 && (
            <section
              className="client-profile-card"
              aria-labelledby="client-contacts"
            >
              <h2 id="client-contacts">Datos de contacto</h2>
              <dl>
                {client.contacts.map((item, index) => (
                  <div key={index}>
                    <dt>{item.label || contactLabels[item.type]}</dt>
                    <dd>
                      {item.value}
                      {item.preferred && (
                        <span className="badge">Preferente</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {client.identifications.length > 0 && (
            <section
              className="client-profile-card"
              aria-labelledby="client-identifications"
            >
              <h2 id="client-identifications">Identificaciones</h2>
              <dl>
                {client.identifications.map((item, index) => (
                  <div key={index}>
                    <dt>{item.type}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      )}
    </>
  );
}
