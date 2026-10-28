# Funcionalidades

`identity/` contiene el acceso con contraseña y MFA y la consulta, renovación y
cierre de sesión. `records/` contiene el recorrido mínimo de clientes y expedientes,
con formularios separados de registro/apertura, listados y detalles. Documentos,
auditoría, configuración y recuperación se incorporarán después.

Cada incremento debe identificar sus casos de uso y criterios de aceptación. La
validación del navegador complementa la del servidor; el acceso efectivo siempre
se comprueba en la API y en los datos. Se reutilizan los estilos mínimos de
`src/app/styles.css`; el diseño definitivo y las animaciones quedan para después.

La composición de la aplicación pertenece a `src/app` y la comunicación HTTP
compartida a `src/shared/api`. No se importan implementaciones del backend.
