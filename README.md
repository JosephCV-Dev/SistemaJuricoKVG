# Sistema Jurídico KVG

Aplicación web interna para gestionar clientes, expedientes y documentos del despacho.
La base incluye la conexión Supabase verificada y CU023/CU024: inicio y cierre de
sesión con contraseña, MFA TOTP y sesión del servidor. El recorrido de identidad se
comprobó por HTTP con Auth y RPC reales en desarrollo; la prueba en navegador y el
despliegue de producción siguen pendientes. Por petición del usuario, la interfaz
tiene estilos mínimos para espaciado, formularios y botones; el diseño definitivo
queda para después.

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
  web/                  Interfaz React con estilos mínimos
    src/app/            Composición de la aplicación
    src/features/       Acceso y MFA; siguientes funcionalidades
    src/shared/api/     Comunicación HTTP
packages/contracts/     Tipos públicos compartidos de la API
database/               SQL original, migraciones y pruebas de datos
docs/                   Arquitectura, análisis y siguientes avances
.github/workflows/      Comprobaciones automáticas
```

Identidad incluye sus endpoints, sesión persistente cifrada y controles de acceso.
Los demás módulos están registrados, con responsabilidades definidas; sus
controladores, casos de uso y adaptadores se añadirán al desarrollar cada función.
El trabajador de archivos y respaldos tendrá una entrada independiente dentro del
mismo backend cuando se implemente el procesamiento persistente.

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

**Comprobar API** sigue disponible sin credenciales mediante `GET /api/v1/health`.
Sólo confirma que responde el proceso HTTP. Para el acceso completo necesitas la
configuración de sesión y las identidades de desarrollo de la [guía de identidad](docs/identity.md).

La configuración predeterminada permite arrancar sin archivos `.env`. Para
cambiarla, copia `apps/api/.env.example` a `apps/api/.env` y
`apps/web/.env.example` a `apps/web/.env`. Si cambias el puerto de la API, ajusta
también `API_PROXY_TARGET` en el archivo de la web. Reinicia los procesos después
de cambiar la configuración. `APP_ORIGIN` debe coincidir con el origen de la web;
usa siempre el mismo host, sin alternar entre `127.0.0.1` y `localhost`.

Ya se prepararon dos cuentas ficticias de desarrollo, administrador y abogado, sin
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
```

`setup:identity:dev` sólo se permite en desarrollo: puede aplicar las migraciones
de identidad, aprovisionar el rol de sesiones, generar secretos locales, crear las
cuentas ficticias y ejecutar el bootstrap si está vacío. La preparación ya se
realizó en este entorno; no hace falta repetirla para abrir la aplicación.
`test:identity:schema` verifica el contrato SQL y revierte su transacción.
`test:identity:live` usa Auth, MFA, sesiones y RPC reales, y modifica únicamente el
entorno de desarrollo preparado para esas pruebas. Consulta sus requisitos y
alcance en [identity.md](docs/identity.md).

Después de compilar, `npm run start:api` inicia la API compilada. El resultado de
la web queda en `apps/web/dist`. El alojamiento final deberá servir web y `/api`
bajo el mismo origen HTTPS; el despliegue todavía no está configurado.

## Base de datos

Se conserva intacta la baseline SQL entregada, instalada previamente por el usuario
y verificada en Supabase. Se aplicaron después las dos migraciones del incremento
de identidad, sin reinstalar la baseline. Ninguna instalación, migración o bootstrap
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
- [Configurar y verificar el Supabase existente](docs/supabase-setup.md).
- [Inicio/cierre de sesión, MFA y pruebas de identidad](docs/identity.md).
- [Actores, reglas y trazabilidad de los 31 casos de uso con Jira](docs/requirements.md).
- [Orden de implementación y ejemplos de futuras peticiones](docs/roadmap.md).

El siguiente avance es el **paso 3: cliente y expediente mínimos**, aprovechando la
sesión y los controles ya implementados. La administración completa de usuarios y
roles (CU018/CU019) sigue pendiente. Puedes pedirlo así:

> Implementa el paso 3: registrar y consultar un cliente ficticio (CU001/CU002,
> SCRUM-13/SCRUM-14), crear su expediente y consultarlo (CU004/CU005,
> SCRUM-41/SCRUM-42). Usa la sesión existente y el contrato RPC; incluye validación,
> permiso, alcance y auditoría, con acceso permitido y denegado verificados. Mantén
> los formularios funcionales con el estilo mínimo existente.

Commit sugerido para el incremento de identidad:

```text
feat(identity): implementar inicio y cierre de sesion con MFA
```
