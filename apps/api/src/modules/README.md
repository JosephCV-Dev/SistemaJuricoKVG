# Módulos del backend

Cada módulo delimita un área funcional. `identity` implementa CU023/CU024 con sus
capas y endpoints de acceso. `clients` y `cases` implementan el recorrido mínimo
de registro/consulta del paso 3A con sus capas y RPC. `documents` implementa el mínimo de carga privada/consulta/descarga y
`operations` el trabajador de verificación. Auditoría y configuración siguen
registrados sin pantallas/endpoints propios completos.

| Carpeta         | Responsabilidad                                                   |
| --------------- | ----------------------------------------------------------------- |
| `identity`      | Identidad, sesión del servidor, MFA, usuarios y permisos vigentes |
| `clients`       | Clientes, identificaciones y contactos                            |
| `cases`         | Expedientes, asignaciones, estados y avances                      |
| `documents`     | Metadatos, versiones, revisión, retiro y acceso a archivos        |
| `audit`         | Consulta autorizada de bitácora y coordinación de auditoría       |
| `configuration` | Catálogos y parámetros acotados                                   |
| `operations`    | Procesamiento persistente, conciliación, respaldos y restauración |

Al desarrollar el primer caso de uso de cada módulo se crean solo las capas necesarias:

- `domain/`: reglas y tipos propios, sin dependencias de Nest ni Supabase.
- `application/`: casos de uso y puertos para servicios externos.
- `infrastructure/`: adaptadores RPC de Supabase y otros proveedores.
- `presentation/`: controladores HTTP y DTO de entrada.

Los controladores validan y delegan; los casos de uso coordinan; PostgreSQL conserva
la integridad transaccional. No consultar tablas de otro módulo directamente ni
duplicar reglas que el SQL ya hace cumplir. Ver `database/README.md`.

El trabajador de `src/worker.ts` se ejecuta por separado y reclama únicamente
trabajos de carga. Usa ClamAV real y un verificador en proceso hijo. El ensayo
cifrado de recuperación se ejecuta explícitamente como herramienta de desarrollo;
no equivale a la operación completa de respaldos/restauración. Véase
[documents.md](../../../../docs/documents.md).
