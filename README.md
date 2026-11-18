# Sistema Jurídico KVG

Aplicación web interna para gestionar clientes, expedientes y documentos del despacho.
La base incluye acceso con MFA y el recorrido mínimo de registrar/consultar clientes
y crear/consultar expedientes con alcance real. Incluye carga privada, análisis
técnico y consulta/descarga de originales autorizados dentro del expediente. Se verificaron HTTP, RPC y PostgreSQL
en desarrollo y un recorrido de Chromium local, incluidos formularios y vista móvil.
El prototipo completo y su despliegue de prueba siguen pendientes. La interfaz adopta el diseño entregado por el usuario: menú lateral, logo KVG,
formularios y vistas separadas, con acciones según las capacidades de la sesión.

**Alcance actual:** seguimos en desarrollo local con el Supabase existente y datos
ficticios, sin nuevas cuentas ni servicios. Antivirus y despliegue separado se
posponen. La demostración local puede habilitar cargas ficticias en modo beta
sin antivirus. Los pasos 4A a 4D añaden consulta, edición, asignaciones y seguimiento
sobre el Supabase de desarrollo. Consulta [seguridad y alcance vigente](docs/security-current-scope.md).

## Arquitectura elegida

Monolito modular por capas con **React + TypeScript + Vite**, **Node + NestJS** y
**PostgreSQL con Supabase Auth y Storage privado**. La revisión RUP de Elaboración
v2.0 incluida en el PDF de Construcción sustituye la propuesta anterior PHP/MySQL.

```text
apps/
  api/                  API NestJS; módulos de negocio y configuración HTTP
    src/modules/
      identity/         Identidad, sesiones, usuarios y permisos
      clients/          Clientes
      cases/            Expedientes, asignaciones y avances
      documents/        Documentos, versiones y revisión
      audit/            Bitácora
      configuration/    Catálogos y parámetros
      operations/       Procesamiento y recuperación
    test/               Pruebas HTTP y de identidad
  web/                  Interfaz React con diseño KVG
    src/app/            Composición de la aplicación
    src/features/       Acceso, clientes y expedientes mínimos
    src/shared/api/     Comunicación HTTP
packages/contracts/     Tipos públicos compartidos de la API
database/               SQL original, migraciones y pruebas de datos
docs/                   Arquitectura, análisis y siguientes avances
.github/workflows/      Comprobaciones automáticas
```

Identidad incluye sus endpoints, sesión persistente cifrada y controles de acceso.
Clientes y expedientes incluyen sus capas, formularios y RPC del recorrido mínimo.
Documentos incluye carga/consulta/descarga y el trabajador de verificación tiene
una entrada independiente en el mismo backend. Los demás módulos y la operación
completa de respaldos se completarán por caso de uso.

## Ejecutar en desarrollo

Requisitos: **Node 24 LTS** y **npm 11 o superior**. `.nvmrc` y `.node-version`
seleccionan Node 24. También se admite Node 26 para desarrollo. Si usas nvm,
ejecuta `nvm install` y `nvm use` desde la raíz.

```sh
npm ci
npm run dev
```

Abre `http://127.0.0.1:5173`. El formulario permite iniciar sesión, verificar MFA,
consultar la sesión y cerrarla. La API escucha en `http://127.0.0.1:3000`; Vite
reenvía `/api` al backend durante desarrollo.

El diagnóstico de API está disponible sin credenciales mediante `GET /api/v1/health`.
Sólo confirma que responde el proceso HTTP. Para el acceso completo necesitas la
configuración de sesión y las identidades de desarrollo de la [guía de identidad](docs/identity.md).

La configuración predeterminada permite arrancar sin archivos `.env`. Para
cambiarla, copia `apps/api/.env.example` a `apps/api/.env` y
`apps/web/.env.example` a `apps/web/.env`. Si cambias el puerto de la API, ajusta
también `API_PROXY_TARGET` en el archivo de la web. Reinicia los procesos después
de cambiar la configuración. `APP_ORIGIN` debe coincidir con el origen de la web;
usa siempre el mismo host, sin alternar entre `127.0.0.1` y `localhost`.

Ya se prepararon tres cuentas ficticias de desarrollo: administrador, abogado y
Secretaría, sin
enviar correos. Sus credenciales y claves TOTP están en
`apps/api/.local/identity-development-accounts.json`, ignorado por Git y con permisos
`0600`. Abre ese archivo únicamente de forma local. Los factores TOTP ya fueron
verificados por las pruebas: importa la clave `totpSecret` de la cuenta elegida en
tu aplicación de autenticación para obtener el código de acceso manual. Sus valores
no deben copiarse a documentación ni capturas.

## Comprobaciones

```sh
npm run check
```

Comprueba formato, tipos estrictos, compilación y pruebas de API y cliente HTTP. La CI ejecuta el
mismo comando con Node 24. También están disponibles `npm run typecheck`,
`npm run build`, `npm test`, `npm run format`, `npm run dev:api` y
`npm run dev:web`.

Las herramientas de identidad se ejecutan explícitamente desde la raíz:

```sh
npm run setup:identity:dev
npm run test:identity:schema
npm run test:identity:live
npm run setup:records:dev
npm run test:records:schema
npm run test:records:live
```

`setup:identity:dev` sólo se permite en desarrollo: puede aplicar las migraciones
de identidad, aprovisionar el rol de sesiones, generar secretos locales, crear las
cuentas ficticias y ejecutar el bootstrap si está vacío. La preparación ya se
realizó en este entorno; no hace falta repetirla para abrir la aplicación.
`test:identity:schema` verifica el contrato SQL y revierte su transacción.
`test:identity:live` usa Auth, MFA, sesiones y RPC reales, y modifica únicamente el
entorno de desarrollo preparado para esas pruebas. Consulta sus requisitos y
alcance en [identity.md](docs/identity.md). La preparación y pruebas de clientes y
expedientes están en [clients-and-cases.md](docs/clients-and-cases.md). Se ejecutan
explícitamente en desarrollo; no forman parte del arranque ni de CI.

Después de compilar, `npm run start:api` inicia la API compilada. El resultado de
la web queda en `apps/web/dist`. El alojamiento final deberá servir web y `/api`
bajo el mismo origen HTTPS. El paquete de contenedores y proxy HTTPS está
preparado y verificado localmente; el alojamiento y la publicación remota
permanecen pendientes. Consulta [staging-deployment.md](docs/staging-deployment.md).

## Base de datos

Se conserva intacta la baseline SQL entregada, instalada previamente por el usuario
y verificada en Supabase. Se aplicaron después las migraciones de identidad y del recorrido de clientes y
expedientes, sin reinstalar la baseline. Ninguna instalación, migración o bootstrap
se ejecuta al arrancar la API. El procedimiento de instalación nueva se conserva
como referencia de reconstrucción.

El backend ya incluye configuración validada y un adaptador RPC por identidad de
usuario. El catálogo remoto se verificó por PostgreSQL; los resultados están en
[el informe de verificación](docs/supabase-verification.md). La configuración HTTP
está restaurada y se confirmó que corresponde al mismo proyecto. El bootstrap de
desarrollo y las sesiones Auth/KVG se comprobaron con identidades ficticias.
Sigue la [guía de integración](docs/supabase-setup.md) para completar
`apps/api/.env`, ejecutar `npm run check:supabase` y revisar el SQL de diagnóstico
de metadatos. El comando no ejecuta migraciones ni operaciones de negocio.

El SQL expone operaciones RPC: el acceso ordinario conserva el JWT real del usuario;
el trabajador técnico utiliza otra identidad. No se añade un ORM ni CRUD directo
porque el modelo suministrado restringe ese acceso. Consulta el
[procedimiento y contrato de datos](database/README.md).

## Documentación y siguientes avances

- [Arquitectura y decisiones](docs/architecture.md).
- [Diseño KVG, navegación y alcance visual](docs/interface.md).
- [Configurar y verificar el Supabase existente](docs/supabase-setup.md).
- [Inicio/cierre de sesión, MFA y pruebas de identidad](docs/identity.md).
- [Cliente y expediente mínimos: contrato, preparación y evidencia](docs/clients-and-cases.md).
- [Actores, reglas y trazabilidad de los 31 casos de uso con Jira](docs/requirements.md).
- [Orden de implementación y ejemplos de futuras peticiones](docs/roadmap.md).

Los pasos **3A** y el recorrido documental local de **3B** están implementados.
3B incorpora también un ensayo acotado de datos/objetos cifrados en PostgreSQL
Docker aislado, con los límites documentados. **3C queda pospuesto** por acuerdo
del usuario. **4A a 4D** están implementados con sus migraciones en desarrollo.
**5A** añade búsqueda documental, clasificación y traslado entre expedientes
autorizados. **5B** incorpora edición del nombre con motivo, publicación de
versiones y descarga autorizada de originales históricos. El siguiente avance
es **5C**, revisión jurídica y estados documentales.

- [Documentos privados, trabajador y verificación](docs/documents.md).
- [Ensayo acotado de copia y recuperación](docs/recovery-rehearsal.md).

Para usar documentos en el desarrollo actual, ejecuta `npm run dev:beta` si la
API y la web están detenidas. Si ya usas `npm run dev`, añade el trabajador en
otra terminal con `npm run worker:documents`. Consulta
[los comandos y límites de la beta](docs/document-beta.md).

Se conserva el paquete de imágenes/proxy y las pruebas HTTPS locales como trabajo
preparado para el futuro, sin exigir ahora servidor, dominio ni segundo Supabase.
[Preparación pospuesta de 3C](docs/staging-deployment.md).

Commit sugerido:

```text
feat(clients): ampliar búsqueda y editar con control de revisión
```
