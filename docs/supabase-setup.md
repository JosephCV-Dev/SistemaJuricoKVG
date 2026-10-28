# Integrar el Supabase existente

El usuario ya aplicó el modelo físico en un proyecto Supabase. La inspección
PostgreSQL confirmó que los elementos comparados coincidían con el SQL. El backend
incluye el adaptador RPC por identidad y CU023/CU024 con MFA y sesión KVG, verificados
con cuentas ficticias. Esta guía conserva el diagnóstico de conexión; la preparación
y prueba del acceso están en [identity.md](identity.md). La preparación ficticia y
pruebas del recorrido mínimo de clientes/expedientes se documentan por separado en
[clients-and-cases.md](clients-and-cases.md).

La revisión del catálogo se completó mediante una conexión SQL de solo lectura.
La configuración HTTP está restaurada y coincide con el mismo proyecto; el paso 1
de conectividad y catálogo está completado. El resultado del 28 de octubre de 2026
y los pendientes están en
[supabase-verification.md](supabase-verification.md).

## 1. Configuración local

`apps/api/.env` es local y está ignorado por Git. Si no existe en otro checkout,
copiar `apps/api/.env.example` a esa ruta. Completar sin eliminar `DATABASE_URL`
si se utiliza para el diagnóstico SQL:

```dotenv
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Obtener ambos valores en el diálogo **Connect** del proyecto o en su configuración
de claves. El adaptador admite claves de formato publishable; rechaza claves
secretas, claves JWT antiguas y configuraciones incompletas. Los valores no se
incluyen en los archivos versionados ni en la salida del diagnóstico.

La configuración es opcional mientras solo se utilice `/api/v1/health`. Para
integrar Supabase hay que completar ambas variables. HTTPS es obligatorio salvo
para una plataforma Supabase local en loopback. Reiniciar la API si estaba abierta.

**Connect / Server / Build API** es una opción para obtener la configuración de
un backend como NestJS. Puede incluir también `SUPABASE_SECRET_KEY` y
`SUPABASE_JWKS_URL`. La clave secret corresponde a operaciones técnicas del
servidor; no sustituye al JWT del usuario ni se añade al frontend. La URL JWKS
señala las claves públicas del proveedor. La integración actual verifica la
identidad mediante `auth.getUser`; no necesita una variable JWKS. La fábrica
ordinaria actual solo utiliza URL, publishable key y el token de cada usuario.

Esa opción del Dashboard es distinta de conectar un plugin Supabase al chat.
Una clave de API permite acceso a los servicios autorizados; no proporciona por
sí sola una conexión PostgreSQL como propietario para inspeccionar todo el catálogo.

Antes de comprobar funciones de negocio hay que confirmar que el proyecto es de
desarrollo y utiliza datos ficticios. La cuenta con la que se entra al Dashboard
de Supabase administra la plataforma; no sustituye a las cuentas individuales de
Supabase Auth y sus perfiles KVG.

## 2. Diagnóstico de conectividad

Desde la raíz del repositorio:

```sh
npm run check:supabase
```

Compila el backend y ejecuta dos solicitudes GET con la clave publishable:

| Servicio | Solicitud           | Qué observa                                                  |
| -------- | ------------------- | ------------------------------------------------------------ |
| Auth     | `/auth/v1/settings` | Accesibilidad del servicio con la configuración suministrada |
| Data API | `/rest/v1/`         | Accesibilidad o restricción del endpoint de metadatos        |

El comando tiene tiempo límite, rechaza redirecciones y no muestra cuerpos de
respuesta, claves ni información de usuarios. No llama RPC, inicia sesiones,
consulta clientes, lista archivos ni modifica la instalación.

Una respuesta 401/403 de Data API se informa como **acceso restringido**: hace falta
la revisión adicional del esquema y privilegios. La visibilidad de funciones para
`anon` está limitada y su ausencia en esa respuesta no demuestra una instalación
fallida. Un código de salida cero solo acredita las comprobaciones de conectividad
indicadas; no equivale a validar el modelo, Storage o los permisos de una persona.

Si faltan variables, falla Auth o no se obtiene una respuesta admisible, el comando
termina con código distinto de cero. No intenta reparar el proyecto ni cambia las
claves o el esquema.

## 3. Diagnóstico del modelo instalado

Ejecutar desde el SQL Editor el archivo
[inspect-existing.sql](../database/diagnostics/inspect-existing.sql), siguiendo
[sus instrucciones](../database/diagnostics/README.md).

La transacción es de solo lectura. Revisa los nombres de las 37 tablas, las firmas
de las tres funciones públicas, privilegios de los roles de aplicación, RLS y
metadatos de los dos buckets privados. No consulta filas de clientes, cuentas Auth,
sesiones ni objetos almacenados. El resultado es un inventario de metadatos, sin
credenciales.

También se puede autorizar la ejecución del diagnóstico desde este entorno mediante
una conexión PostgreSQL localmente configurada. En Supabase, **Connect / Connection
string / Session pooler** proporciona la URI; completar su contraseña de base de
datos y guardarla como `DATABASE_URL` en `apps/api/.env`, sin copiarla al chat ni
al repositorio. Esa variable se reserva a herramientas SQL autorizadas de desarrollo y no cambia
el acceso ordinario RPC de la aplicación. El comando `check:supabase` comprueba
únicamente los servicios HTTP; no ejecuta automáticamente ese diagnóstico SQL.

No volver a ejecutar la baseline sobre el proyecto existente. Si aparecen
diferencias, hay que revisar su origen y decidir si se necesita una migración. El
diagnóstico no compara todos los cuerpos de funciones, columnas, restricciones,
índices o políticas de objetos; tampoco demuestra que se haya realizado el bootstrap.

## 4. Adaptador RPC e identidad del servidor

`SupabaseModule` registra una fábrica de clientes y `KvgRpcService`. Cada llamada
interna utiliza un cliente nuevo con la clave publishable y el token del usuario,
sin persistencia de sesión ni renovación automática. El módulo de identidad
proporciona un token procedente de la sesión validada del servidor; esta
fábrica no autentica al usuario.

Solo se invoca `public.kvg_operar`. Se comprueban el error de transporte y el
envoltorio JSON: HTTP 200 con `correcto: false` es un rechazo. Los códigos conocidos
se traducen a errores HTTP seguros; los mensajes internos del proveedor no se
propagan. `datos` permanece como `unknown` hasta que el caso de uso valide su forma.
No se añaden reintentos automáticos ni una ruta HTTP que acepte RPC arbitrarias.

No se configura una identidad administrativa como sustituto del usuario. Las
preparación de cuentas ficticias usa la API administrativa Auth únicamente en una
herramienta explícita de desarrollo. El almacén de sesión del proceso HTTP tiene
su propio rol restringido, sin acceso a tablas KVG. Storage y los trabajadores se
integrarán con credenciales técnicas separadas cuando corresponda.

## 5. Evidencia y siguiente paso

La preparación incluye pruebas locales con un servidor HTTP controlado para
comprobar aislamiento de tokens, contrato RPC, traducción de errores y diagnóstico
de solo lectura. Estas pruebas no se ejecutan contra el proyecto remoto ni
acreditan seguridad funcional de Supabase.

La revisión inicial quedó cerrada con la configuración del entorno, el diagnóstico
HTTP y la inspección SQL de metadatos. Se confirmó que ambos accesos corresponden
al mismo proyecto. Posteriormente se aplicaron dos migraciones explícitas y se
prepararon dos identidades ficticias, con bootstrap previo revisado y sin correos.

CU023/CU024 — SCRUM-149/SCRUM-150 incluye identidad, MFA, sesión operativa KVG,
persistencia cifrada, CSRF, renovación y cierre. Se comprobaron una operación RPC
permitida y otra denegada con identidades reales de desarrollo. Consulta el
[procedimiento de identidad](identity.md) y el [informe](supabase-verification.md)
para comandos, evidencias y límites. Estos scripts requieren configuración local
adicional; no forman parte del diagnóstico GET ni se ejecutan al iniciar la API.
Las RPC pueden actualizar actividad y registrar auditoría incluso al rechazar
una operación; por eso no se ejecutan como diagnóstico de solo lectura.

Referencias oficiales:

- [Claves de API y roles](https://supabase.com/docs/guides/getting-started/api-keys).
- [Inicialización del SDK](https://supabase.com/docs/reference/javascript/initializing).
- [Invocación de funciones RPC](https://supabase.com/docs/reference/javascript/rpc).
