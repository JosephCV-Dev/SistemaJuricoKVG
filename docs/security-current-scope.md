# Seguridad y alcance con los recursos actuales

Decisión del usuario del 10 de noviembre de 2026: continuar con el proyecto
Supabase existente, desarrollo local y datos ficticios. No crear cuentas, contratar
servicios ni integrar APIs externas adicionales. Se posponen antivirus operativo y
despliegue separado; el siguiente avance funcional es clientes 4A.

## Controles disponibles sin servicios nuevos

| Área                    | Comportamiento implementado                                                                                             | Límite                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Identidad               | Supabase Auth existente, invitación y MFA TOTP; sesión operativa AAL2                                                   | Administración completa de usuarios/permisos pendiente                                   |
| Sesión                  | Cookie opaca HttpOnly/SameSite; tokens solo en servidor, persistencia cifrada, expiración, rotación y revocación        | Secure en HTTPS de producción; desarrollo local usa HTTP                                 |
| Peticiones              | Origen exacto y CSRF para mutaciones, DTO y errores sin secretos, límites de intentos por proceso                       | Límites distribuidos pendientes si se adoptan varias instancias                          |
| Autorización            | Guards que deniegan por defecto y RPC con identidad, permiso/contexto y alcance del recurso; RLS/privilegios existentes | Cada nuevo CU requiere pruebas específicas; administrador no equivale a lectura jurídica |
| Integridad              | Restricciones SQL, auditoría, solicitudes idempotentes y revisiones según el CU                                         | La pantalla de bitácora y varias actualizaciones siguen pendientes                       |
| Archivos ya habilitados | Buckets privados, autorización ordinaria antes del broker técnico, hash y reautorización en descarga                    | Nuevas cargas pausadas; no se afirma seguridad por extensión/MIME/hash                   |
| Secretos                | Fuera de Git/frontend, rol SQL limitado de sesiones; soporte de archivos montados, imágenes sin `.env`                  | Custodia y rotación de producción pendientes                                             |
| Recuperación            | Herramienta de ensayo cifrado y restauración aislada en PostgreSQL local                                                | No sustituye copia programada completa ni restauración de Supabase Auth/Storage          |

Estas capacidades aprovechan código local y el Supabase ya configurado. No son
servicios nuevos ni prueba de que todas las etapas del proyecto estén terminadas.
Las evidencias previas están en `identity.md`, `clients-and-cases.md`,
`documents.md`, `recovery-rehearsal.md` y `staging-deployment.md`.

## Pausa de cargas sin desactivar la verificación

- `DOCUMENT_UPLOAD_MODE=paused` es el valor predeterminado. Se valida estrictamente;
  valores vacíos, desconocidos o booleanos no habilitan cargas.
- La API comunica disponibilidad solo a sesiones con permiso de carga. Rechaza
  creación y recepción con 503, también ante una petición manual, antes de consumir
  bytes o escribir en Storage. Identidad, permiso y CSRF siguen aplicándose.
- La pantalla documental conserva su diseño y muestra la pausa. No presenta un
  archivo pendiente como disponible. Los originales previamente verificados siguen
  sujetos a los permisos, alcance y hash al consultar/descargar.
- El trabajador pausado sale sin conectarse a Supabase ni reclamar trabajos; no
  agota reintentos por ausencia deliberada de antivirus. No modifica cargas previas.
- La integración ClamAV se conserva para después. `verified` requiere activación
  explícita en API y trabajador y análisis real; no incorpora un resultado ficticio
  ni permite publicación estructural sin antimalware. Compose reserva trabajador y
  ClamAV al perfil `document-verification`.

El control de pausa está en la aplicación; no altera ni revoca las funciones de
la baseline. Los permisos SQL, cuarentena y requisitos de publicación permanecen.
Detener procesos anteriores/reiniciar API y web para cargar esta versión; no hay
recarga de política a mitad de una petición. No se ejecutaron migraciones,
restauraciones, creación de cuentas ni cambios remotos en este ajuste.

## Plan y verificación

Se continúa con consulta/actualización de clientes, expediente y seguimiento sin
exigir infraestructura nueva. Las ampliaciones documentales que publiquen nuevas
versiones dependen de retomar el análisis. RUP RN10/16.6, staging separado,
recuperación integral y lanzamiento permanecen abiertos. El preflight futuro sigue
impidiendo confundir desarrollo con un entorno separado; no hay que ejecutarlo
para trabajar localmente ahora.

Las pruebas de este ajuste comprueban pausa predeterminada, configuración inválida,
POST/PUT manuales denegados sin RPC/Storage, protección del endpoint informativo,
descarga autorizada durante la pausa, trabajador sin credenciales/conexión y
validación del contrato del cliente. **`npm run check` pasó: 62 pruebas de API y
17 del cliente HTTP (79 en total), formato, tipos y compilación.** Compose se
validó sin arrancar servicios: por defecto solo web/API; con perfil explícito
incorpora trabajador/antivirus. La baseline conserva su checksum. La evidencia real
de antivirus anterior es histórica; no se vuelve a iniciar ClamAV en este ajuste.
Las imágenes previas deben recompilarse antes de un uso posterior. No se realizó
una nueva prueba de navegador o despliegue remoto para este cambio.

Commit sugerido: `feat(security): pausar cargas sin analizador y ajustar el roadmap local`.
