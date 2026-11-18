import { Icon } from '../../shared/ui/Icon';
import { useEffect, useRef, useState } from 'react';
import type {
  ConfigurationCategory,
  ConfigurationIdentification,
  ConfigurationParameter,
  ConfigurationSnapshot,
  SessionParameterCode,
} from '@kvg/contracts';
import type { RunDocumentAction } from '../documents/DocumentDetails';
import { configurationSnapshot, saveConfiguration } from './administration-api';

const parameters = {
  'sesion.inactividad_minutos': {
    name: 'Inactividad de sesión (minutos)',
    min: 5,
    max: 30,
  },
  'sesion.duracion_horas': {
    name: 'Duración máxima de la sesión (horas)',
    min: 1,
    max: 8,
  },
};

type Editor =
  | {
      kind: 'parameter';
      record: ConfigurationParameter & { code: SessionParameterCode };
    }
  | { kind: 'category'; record?: ConfigurationCategory }
  | { kind: 'identification'; record?: ConfigurationIdentification };

function editableParameter(
  item: ConfigurationParameter,
): item is ConfigurationParameter & { code: SessionParameterCode } {
  return item.editable && Object.hasOwn(parameters, item.code);
}

function save(editor: Editor, form: FormData, signal: AbortSignal) {
  const change = {
    reason: form.get('reason'),
    confirmed: form.has('confirmed'),
  };
  if (editor.kind === 'parameter') {
    const { code, revision } = editor.record;
    return saveConfiguration(
      '/parameters/' + code,
      'PATCH',
      {
        ...change,
        revision,
        value: Number(form.get('value')),
      },
      signal,
    );
  }

  const name = form.get('name');
  const code = form.get('code');
  const active = form.has('active');
  if (editor.kind === 'category') {
    const description = form.get('description');
    return editor.record
      ? saveConfiguration(
          '/categories/' + editor.record.id,
          'PATCH',
          {
            ...change,
            name,
            description,
            active,
            revision: editor.record.revision,
          },
          signal,
        )
      : saveConfiguration(
          '/categories',
          'POST',
          { ...change, code, name, description },
          signal,
        );
  }
  return editor.record
    ? saveConfiguration(
        '/identification-types/' + encodeURIComponent(editor.record.code),
        'PATCH',
        {
          ...change,
          name,
          active,
          revision: editor.record.revision,
        },
        signal,
      )
    : saveConfiguration(
        '/identification-types',
        'POST',
        {
          ...change,
          code,
          name,
          rule: form.get('rule'),
          unique: form.has('unique'),
        },
        signal,
      );
}

function ConfigurationEditor({
  editor,
  busy,
  onCancel,
  onSave,
}: {
  editor: Editor;
  busy: boolean;
  onCancel: () => void;
  onSave: (form: FormData) => void;
}) {
  const range =
    editor.kind === 'parameter' ? parameters[editor.record.code] : null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(new FormData(event.currentTarget));
      }}
    >
      <fieldset disabled={busy}>
        <legend>
          {range?.name ??
            (editor.kind === 'category'
              ? 'Categoría documental'
              : 'Tipo de identificación')}
        </legend>
        {editor.kind === 'parameter' && range && (
          <>
            <p>
              <label htmlFor="config-value">
                Valor ({range.min} a {range.max})
              </label>
              <input
                id="config-value"
                type="number"
                name="value"
                min={range.min}
                max={range.max}
                defaultValue={editor.record.value}
                required
              />
            </p>
            <p>
              {editor.record.code === 'sesion.duracion_horas'
                ? 'Se aplica a las nuevas sesiones.'
                : 'Se aplica a la validación de actividad de las sesiones.'}
            </p>
          </>
        )}
        {editor.kind !== 'parameter' && (
          <>
            <p>
              <label htmlFor="config-code">Código</label>
              <input
                id="config-code"
                name="code"
                pattern="[A-Z][A-Z0-9_]{0,63}"
                maxLength={64}
                defaultValue={editor.record?.code}
                readOnly={!!editor.record}
                required
              />
            </p>
            <p>
              <label htmlFor="config-name">Nombre</label>
              <input
                id="config-name"
                name="name"
                maxLength={200}
                defaultValue={editor.record?.name}
                required
              />
            </p>
            {editor.kind === 'category' && (
              <p>
                <label htmlFor="config-description">Descripción</label>
                <textarea
                  id="config-description"
                  name="description"
                  maxLength={2000}
                  defaultValue={editor.record?.description ?? ''}
                />
              </p>
            )}
            {editor.kind === 'identification' && !editor.record && (
              <>
                <p>
                  <label htmlFor="config-rule">Normalización</label>
                  <select id="config-rule" name="rule">
                    <option value="EXACTA_V1">Exacta</option>
                    <option value="MAYUSCULAS_V1">Mayúsculas</option>
                    <option value="ALFANUMERICA_V1">Alfanumérica</option>
                  </select>
                </p>
                <p>
                  <label>
                    <input type="checkbox" name="unique" /> Exigir
                    identificación única
                  </label>
                </p>
              </>
            )}
            {editor.record && (
              <p>
                <label>
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={editor.record.active}
                  />{' '}
                  Disponible para nuevos registros
                </label>
              </p>
            )}
          </>
        )}
        <p>
          <label htmlFor="config-reason">Motivo del cambio</label>
          <textarea
            id="config-reason"
            name="reason"
            maxLength={2000}
            required
          />
        </p>
        <p>
          <label>
            <input type="checkbox" name="confirmed" required /> Confirmo este
            cambio
          </label>
        </p>
        <div className="actions">
          <button type="submit">Guardar cambio</button>
          <button className="button-secondary" type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function ConfigurationWorkspace({
  busy,
  run,
  onNotice,
  autoLoad,
}: {
  busy: boolean;
  run: RunDocumentAction;
  onNotice: (message: string) => void;
  autoLoad: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ConfigurationSnapshot | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const loaded = useRef(false);

  function load() {
    loaded.current = true;
    void run(async (signal) => {
      setEditor(null);
      setSnapshot(await configurationSnapshot(signal));
    });
  }

  useEffect(() => {
    if (autoLoad && !busy && !loaded.current) {
      loaded.current = true;
      load();
    }
  }, [autoLoad, busy]);

  return (
    <section className="panel" aria-labelledby="configuration-heading">
      <div className="section-header">
        <h2 id="configuration-heading">Configuración</h2>
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={load}
        >
          Actualizar configuración
        </button>
      </div>
      {editor && (
        <ConfigurationEditor
          key={editor.kind + (editor.record?.code ?? '-new')}
          editor={editor}
          busy={busy}
          onCancel={() => setEditor(null)}
          onSave={(form) =>
            void run(async (signal) => {
              await save(editor, form, signal);
              setEditor(null);
              setSnapshot(null);
              setSnapshot(await configurationSnapshot(signal));
              onNotice('Cambio de configuración registrado.');
            })
          }
        />
      )}
      {snapshot && (
        <>
          <h3>Parámetros del sistema</h3>
          <div
            className="table-wrap"
            role="region"
            aria-label="Parámetros del sistema"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Parámetro</th>
                  <th>Valor</th>
                  <th>Revisión</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.parameters.map((item) => (
                  <tr key={item.code}>
                    <td>
                      {editableParameter(item)
                        ? parameters[item.code].name
                        : item.code === 'sistema.bloqueado'
                          ? 'Bloqueo del sistema'
                          : item.code}
                    </td>
                    <td>{item.value}</td>
                    <td>{item.revision}</td>
                    <td>
                      {editableParameter(item) ? (
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={busy}
                          onClick={() =>
                            setEditor({ kind: 'parameter', record: item })
                          }
                        >
                          Editar parámetro
                        </button>
                      ) : (
                        'Solo lectura'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="section-header">
            <h3>Categorías documentales</h3>
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => setEditor({ kind: 'category' })}
            >
              <Icon name="add" />
              Nueva categoría
            </button>
          </div>
          <div
            className="table-wrap"
            role="region"
            aria-label="Categorías documentales"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.categories.map((record) => (
                  <tr key={record.id}>
                    <td>{record.code}</td>
                    <td>{record.name}</td>
                    <td>{record.description ?? '—'}</td>
                    <td>{record.active ? 'Activa' : 'Inactiva'}</td>
                    <td>
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={busy}
                        onClick={() => setEditor({ kind: 'category', record })}
                      >
                        Editar categoría
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="section-header">
            <h3>Tipos de identificación</h3>
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => setEditor({ kind: 'identification' })}
            >
              <Icon name="add" />
              Nuevo tipo
            </button>
          </div>
          <div
            className="table-wrap"
            role="region"
            aria-label="Tipos de identificación"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Normalización</th>
                  <th>Único</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.identifications.map((record) => (
                  <tr key={record.code}>
                    <td>{record.code}</td>
                    <td>{record.name}</td>
                    <td>{record.rule}</td>
                    <td>{record.unique ? 'Sí' : 'No'}</td>
                    <td>{record.active ? 'Activo' : 'Inactivo'}</td>
                    <td>
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={busy}
                        onClick={() =>
                          setEditor({ kind: 'identification', record })
                        }
                      >
                        Editar tipo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
