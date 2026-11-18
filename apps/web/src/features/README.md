# Funcionalidades

`identity/` contiene el acceso con contraseña y MFA y la consulta, renovación y
cierre de sesión. `records/` contiene el recorrido mínimo de clientes y expedientes,
con formularios separados de registro/apertura, listados y detalles. `documents/`
contiene la carga, consulta, descarga y recuperación de documentos.

`administration/` contiene Bitácora y Configuración. Los componentes de
Usuarios y permisos están en `identity/`.

Cada incremento debe identificar sus casos de uso y criterios de aceptación. La
validación del navegador complementa la del servidor; el acceso efectivo siempre
se comprueba en la API y en los datos. Se reutiliza la base visual KVG de `src/app/styles.css`, adaptada a la maqueta
entregada por el usuario. La navegación separa listas, formularios y detalles;
`CaseDetailView` presenta resumen, historial y avances. No se incluyen acciones
de módulos pendientes ni datos de demostración incrustados.

La composición de la aplicación pertenece a `src/app` y la comunicación HTTP
compartida a `src/shared/api`. No se importan implementaciones del backend.
