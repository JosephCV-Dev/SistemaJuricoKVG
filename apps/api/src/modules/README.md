# Módulos del backend

Cada módulo delimita un área funcional. Las clases `*.module.ts` están registradas,
pero todavía no exponen operaciones de negocio.

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

El trabajador futuro tendrá una entrada independiente dentro de esta aplicación y
reutilizará `operations`. No se ha implementado un bucle de trabajos, antimalware ni copias.
