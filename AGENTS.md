# Trabajo en Sistema Jurídico KVG

- Consultar `README.md`, `docs/architecture.md`, `docs/requirements.md` y el CU/Jira
  afectado antes de implementar un avance.
- La base vigente es RUP Elaboración v2.0: React/TypeScript/Vite, NestJS y Supabase.
  Mantener el monolito modular y los límites de capas descritos en la documentación.
- Priorizar recorridos funcionales. El usuario ha pospuesto colores, animaciones y
  diseño visual hasta que los solicite; usar controles HTML semánticos provisionales.
- Implementar validación del servidor, identidad, sesión, permiso y alcance junto al
  caso de uso. No considerar autorización ocultar elementos de interfaz.
- Seguir el contrato RPC del SQL suministrado; no usar claves privilegiadas como
  sustituto de la identidad del usuario ni crear CRUD directo sobre tablas.
- Conservar intacta `database/baseline/Modelo_Fisico_KVG_PostgreSQL.sql`. Registrar
  modificaciones necesarias en nuevas migraciones con sus motivos y verificaciones.
- No ejecutar instalación o migraciones al arrancar la API. Usar entornos separados
  y datos ficticios para desarrollo; no guardar datos reales, credenciales ni respaldos
  en el repositorio.
- Añadir capas, abstracciones y dependencias cuando exista una necesidad concreta.
  No crear funcionalidades simuladas que declaren seguridad, análisis o respaldos listos.
- Ejecutar `npm run check` tras cambios de código y pruebas relevantes del CU.
  Documentar límites de verificación y proponer un nombre de commit; no crear el commit
  si el usuario solo ha pedido su nombre.
