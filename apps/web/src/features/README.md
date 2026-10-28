# Funcionalidades

Aquí se incorporarán las pantallas y formularios por módulo funcional: identidad,
clientes, expedientes, documentos, auditoría y configuración, y recuperación.

Cada incremento debe identificar sus casos de uso y criterios de aceptación. La
validación del navegador complementa la del servidor; el acceso efectivo siempre
se comprueba en la API y en los datos. No se agregan estilos ni animaciones durante
esta etapa.

La composición de la aplicación pertenece a `src/app` y la comunicación HTTP
compartida a `src/shared/api`. No se importan implementaciones del backend.
