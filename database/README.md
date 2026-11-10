# Base de datos KVG

La base utiliza PostgreSQL 15 o superior con Supabase Auth y Storage privado. El SQL recibido contiene 37 tablas en `kvg`, funciones internas en `kvg_privado`, restricciones, catálogos, políticas RLS y puntos de entrada RPC. La revisión de catálogo del 28 de octubre de 2026 confirmó los elementos comparados de la baseline. El alcance de esa revisión está en [el informe de verificación](../docs/supabase-verification.md).

El usuario aplicó el modelo en su proyecto Supabase y se completó
[el diagnóstico de la instalación existente](diagnostics/README.md). La
configuración HTTP del backend se restauró y se confirmó que corresponde al mismo
proyecto. El procedimiento está en [la guía de integración](../docs/supabase-setup.md).
La instalación nueva descrita a continuación solo se utiliza para reconstruir
otro entorno; no se repite sobre la base ya instalada.

CU023/CU024 están implementados y verificados en desarrollo. Se aplicaron
explícitamente las dos migraciones de sesión y se ejecutó el bootstrap con dos
identidades Auth ficticias distintas y confirmadas. Las pruebas con el proveedor
real comprobaron contraseña/MFA, sesión operativa, RPC permitida/denegada,
revocación y expiración. Las pruebas HTTP locales cubren además CSRF, cookies,
renovación concurrente, cierre, cuenta inactiva y capacidades/contextos mediante
puertos simulados. El paso 3A añade el recorrido mínimo de clientes/expedientes,
una identidad ficticia de Secretaría y pruebas reales de alcance, idempotencia y
auditoría, además de Chromium local. Storage y recuperación siguen pendientes.
Consulta [identidad](../docs/identity.md) y [cliente/expediente](../docs/clients-and-cases.md).

## Archivos y procedencia

| Ruta                                        | Propósito                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `baseline/Modelo_Fisico_KVG_PostgreSQL.sql` | Copia íntegra del modelo físico entregado por el usuario.                                                                    |
| `migrations/`                               | Cambios incrementales explícitos sobre la baseline, incluidas sesiones, idempotencia y responsables aplicados en desarrollo. |
| `tests/README.md`                           | Casos de integración pendientes antes de utilizar datos reales.                                                              |

Archivo de origen: `Modelo_Fisico_KVG_PostgreSQL.sql`, entregado junto con el modelo conceptual/lógico y diccionario KVG versión 1.1, derivado del RUP de Elaboración versión 2.0. La copia conserva exactamente sus bytes.

SHA-256 del original y de la copia:

```text
51ae14882b93f9c43e24b669f740d018636e29767d1c9525da001f27bedda707
```

Para comprobar la copia desde la raíz del repositorio:

```sh
sha256sum database/baseline/Modelo_Fisico_KVG_PostgreSQL.sql
```

La baseline se conserva como referencia. Las correcciones futuras deben quedar en archivos nuevos de `migrations/`, acompañadas de su motivo y validación; no se reescribe el original para ocultar cambios.

## Migraciones aplicadas en desarrollo

| Archivo                                     | Cambio                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `202610280001_server_sessions.sql`          | Crea `kvg_servidor.sesion_web` y el rol limitado `kvg_session_store` para la persistencia técnica; SID como hash, carga cifrada y marcas de revocación.              |
| `202610280002_identity_session_context.sql` | Añade el helper privado `consultar_sesion()` y la operación fija `sesion.consultar` en `public.kvg_operar`, conservando el despachador y los privilegios ordinarios. |
| `202610280003_record_creation_requests.sql` | Garantía transaccional de reintento por actor, operación y UUID. Tabla privada con hash/recurso, sin datos personales; revalida alcance en cada repetición.          |
| `202610280004_case_responsible_names.sql`   | Añade nombres de responsables exclusivamente al detalle de expediente ya autorizado, sin exponer directorio global.                                                  |

Se aplicaron explícitamente como propietario, con verificación posterior. La API
no ejecuta estas migraciones al arrancar. La tabla técnica se mantiene fuera de las
37 tablas de negocio de `kvg`, y su rol no obtiene permisos sobre KVG, Auth o
Storage. La nueva función de contexto incrementa el inventario de funciones KVG
respecto a las 43 de la baseline. El contrato está en
[identity-session-contract.md](identity-session-contract.md). Las migraciones 003/004
y su contrato están en [clients-and-cases.md](../docs/clients-and-cases.md). El
registro de checksum impide repetir o cambiar una migración ya aplicada.
`npm run setup:records:dev` prepara explícitamente el entorno ficticio y
`npm run test:records:schema` comprueba los privilegios privados en solo lectura.

## Instalación inicial (solo para un entorno nuevo)

1. Preparar un proyecto Supabase de desarrollo nuevo y sin datos. Para desarrollo local se necesita la plataforma Supabase completa, incluidos Auth y Storage; una instancia aislada de PostgreSQL no satisface los prerrequisitos.
2. Comprobar PostgreSQL 15+, las tablas `auth.users`, `auth.sessions`, `storage.buckets` y `storage.objects`, los roles de Supabase y la capacidad del propietario para instalar `pgcrypto` y `btree_gist`.
3. Verificar que todavía no existen los esquemas de la aplicación `kvg` y `kvg_privado`, ni los buckets `kvg-cuarentena` y `kvg-originales`.
4. Revisar el SQL y ejecutar el archivo completo una vez como propietario del proyecto. Incluye su propia transacción `BEGIN`/`COMMIT`; no se ejecuta al iniciar la API ni desde una petición HTTP.
5. Registrar fecha, responsable, entorno y checksum aplicado. Revisar las restricciones y privilegios creados antes de inicializar las cuentas.
6. Completar el bootstrap de identidades descrito abajo y ejecutar las pruebas de integración en ese entorno de desarrollo.

La instalación no es reejecutable: rechaza un esquema `kvg` previo y no actualiza una instalación existente. No se debe solucionar un fallo borrando esquemas o datos automáticamente. Los cambios sobre una instalación existente requieren una migración explícita.

El entorno actual ya tiene baseline, migraciones y bootstrap de desarrollo. Los
pasos anteriores son una referencia para reconstruir otro entorno; no se repiten
sobre el proyecto verificado.

## Bootstrap de identidades

La función inicial es:

```text
public.kvg_inicializar(
  p_auth_administrador uuid,
  p_auth_juridico uuid,
  p_nombre_administrador text,
  p_nombre_juridico text,
  p_referencia_aprobacion text
) → jsonb
```

Se ejecuta como propietario, una única vez y después de instalar la baseline. Se requieren dos identidades distintas ya existentes en Supabase Auth, ambas con correo confirmado: un responsable técnico y un responsable jurídico. También se requiere una referencia identificable de aprobación. En producción deben corresponder a los responsables designados; para este entorno de desarrollo se utilizaron dos identidades ficticias distintas autorizadas para pruebas, con credenciales individuales fuera del repositorio.

La función exige que `kvg.usuario` esté vacío. Crea los perfiles operativos, asigna `ADMINISTRADOR` y `ABOGADO`, carga la matriz inicial de capacidades y registra los parámetros de sesión. Devuelve `administrador_usuario_id` y `responsable_juridico_usuario_id`, que son identificadores operativos KVG, distintos de los identificadores Auth de entrada.

`anon`, `authenticated` y `service_role` no pueden ejecutar esta función. El resto de las altas se tramitará mediante los casos de uso de administración y la conciliación de identidad; no mediante inserciones manuales en las tablas.

El bootstrap de desarrollo ya está realizado; no se ejecuta otra vez. La consulta
de conteos del [contrato de sesión](identity-session-contract.md) permite revisar
su estado sin publicar nombres, correos ni identificadores. Las interfaces y los
recorridos completos de CU018/CU019 siguen pendientes; el bootstrap y el contexto
vigente constituyen sus prerrequisitos.

## Contrato de acceso de la aplicación

| Identidad de conexión                               | Punto de entrada                                                       | Uso                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| JWT real del usuario, rol `authenticated`           | `public.kvg_operar(p_operacion text, p_datos jsonb)`                   | Operaciones del personal, incluidas consultas.                                    |
| Credencial técnica del servidor, rol `service_role` | `public.kvg_trabajar(p_operacion text, p_datos jsonb)`                 | Trabajos de archivos, conciliación de identidades y respaldos.                    |
| Propietario de la instalación                       | `public.kvg_inicializar(...)`                                          | Bootstrap inicial.                                                                |
| Rol técnico `kvg_session_store`                     | `kvg_servidor.sesion_web`, mediante su conexión PostgreSQL restringida | Persistencia cifrada de sesiones web; sin acceso directo a las tablas de negocio. |

El adaptador del backend crea un cliente Supabase por petición con el JWT del usuario. Un ejemplo de llamada para el futuro caso de uso de consulta es:

```ts
const { data, error } = await userClient.rpc('kvg_operar', {
  p_operacion: 'cliente.consultar',
  p_datos: { cliente_id: clienteId },
});
```

Esta llamada exige tanto una sesión autorizada como acceso al cliente solicitado; el ejemplo no constituye un endpoint implementado. Las operaciones se seleccionan en cada caso de uso del backend, con datos validados; no se expone un endpoint que acepte cualquier nombre de operación enviado por el navegador.

El backend debe comprobar el error de transporte y el resultado funcional. `kvg_operar` captura rechazos y puede responder HTTP 200 con uno de estos envoltorios:

```json
{ "correcto": true, "datos": {} }
```

```json
{ "correcto": false, "codigo": "42501", "mensaje": "Operación no autorizada." }
```

| Código SQLSTATE | Significado para el adaptador                                               |
| --------------- | --------------------------------------------------------------------------- |
| `42501`         | Operación no autorizada.                                                    |
| `40001`         | Revisión desactualizada; presentar conflicto y recargar el recurso.         |
| `23505`         | Clave duplicada.                                                            |
| `P0002`         | Recurso no disponible.                                                      |
| Otros           | Rechazo de datos o fallo que debe traducirse sin revelar detalles internos. |

El envoltorio anterior corresponde a `kvg_operar`. `kvg_trabajar` devuelve el resultado técnico de cada operación y puede propagar errores SQL; su adaptador debe manejar ambos sin asumir el mismo formato.

## Sesiones, permisos y archivos

- La identidad y sesión proceden de `auth.uid()` y `auth.jwt()`, nunca de campos de autor, roles o permisos enviados en `p_datos`.
- La operación `sesion.iniciar`, con `p_datos: {}`, requiere JWT con MFA `aal2`, sesión Auth real y cuenta KVG activa. Registra la sesión operativa; un token Auth de primer factor no basta.
- `sesion.consultar`, con `p_datos: {}`, revalida la sesión y devuelve identidad operativa, roles, capacidades por contexto y límites efectivos, sin datos jurídicos. La API lo utiliza antes de autorizar cada petición privada; no concede por sí mismo alcance a un expediente.
- Las operaciones posteriores comprueban la cuenta, la sesión operativa, los permisos actuales y el alcance del expediente. La configuración inicial permite hasta 8 horas de sesión y 30 minutos de inactividad; son valores del SQL sujetos a la validación funcional pendiente PT02.
- `sesion.cerrar` revoca la sesión operativa KVG. El flujo implementado coordina el cierre del proveedor, la revocación de la sesión web y la limpieza de la cookie; se comprueba el rechazo de su reutilización.
- Los roles funcionales son `SECRETARIA`, `ABOGADO` y `ADMINISTRADOR`. Los contextos de capacidad son `PRINCIPAL`, `COLABORADOR`, `EXPLICITO`, `GLOBAL_OPERATIVO` y `REGISTRO_PROPIO`. Tener un rol no concede acceso automático a todos los expedientes.
- Los privilegios finales deniegan acceso directo a tablas, secuencias y funciones privadas a `anon`, `authenticated` y `service_role`. Las políticas RLS complementan el control por funciones; no habilitan consultas directas ni CRUD mediante un ORM.
- La credencial `service_role` pertenece exclusivamente al servidor y a trabajadores técnicos. No representa al usuario para operaciones de negocio y nunca debe incluirse en variables `VITE_*`.
- Los buckets privados son `kvg-cuarentena` y `kvg-originales`. La baseline admite PDF, DOCX, JPEG y PNG hasta 20 000 000 bytes. El acceso directo de `anon` y `authenticated` queda bloqueado; cargas y entregas se canalizan por el servidor.
- La aplicación debe ejecutar la verificación técnica, antimalware, cálculo fiable de hash, copia de objetos y recuperación. El SQL registra y autoriza esos resultados; no realiza por sí mismo esos procesos externos.

La baseline concreta decisiones todavía pendientes de validación en los documentos: PT01–PT08. Su conservación en el repositorio no aprueba tipos nuevos de cliente, varios clientes por expediente, facultades jurídicas, conservación automática ni objetivos de recuperación sin un ensayo real.

## Documentos y ensayo 3B

Las migraciones `202611040005_document_upload_workflow.sql` y
`202611040006_document_detail_and_failed_jobs.sql` añaden estado por autor,
reclamo exclusivo de cargas, metadatos legibles y agotamiento visible de trabajos.
Conservan los privilegios y la baseline. Se aplican con `npm run setup:documents:dev`,
nunca al arrancar la API. `npm run test:documents:schema` verifica el contrato
sin escritura. El ensayo `npm run rehearse:recovery:dev` solo lee el origen y
restaura en un PostgreSQL Docker efímero sin red: véanse
[documentos](../docs/documents.md) y [límites de recuperación](../docs/recovery-rehearsal.md).
