# Revisar una instalación Supabase existente

`inspect-existing.sql` prepara la revisión del proyecto donde ya se ejecutó el SQL.
No hay que volver a instalar la baseline para utilizarlo. El archivo inicia una
transacción `READ ONLY`, consulta metadatos y termina con `ROLLBACK`.

## Ejecutar desde el SQL Editor

1. Abrir el proyecto Supabase que contiene la instalación KVG y confirmar que es el
   entorno de desarrollo que se desea revisar.
2. Crear una consulta en el SQL Editor, con el rol propietario que pueda consultar
   los catálogos y la configuración de Storage.
3. Copiar el contenido completo de `inspect-existing.sql` y ejecutarlo sin añadir
   el archivo de instalación ni llamadas a funciones KVG.
4. Revisar las ocho filas de `seccion` / `resultado`. Cada resultado contiene un
   objeto o lista JSON con nombres técnicos y metadatos. Si el editor muestra solo
   el estado del último `ROLLBACK`, consultar el resultado del `SELECT` en el
   historial de ejecución.

El informe no incluye credenciales y puede servir para revisar diferencias con el
modelo del repositorio. No se debe acompañar con claves de API, cadenas de conexión,
usuarios Auth, registros de clientes, documentos ni capturas que los contengan.

La única tabla ajena a `pg_catalog` consultada es `storage.buckets`, limitada a los
identificadores `kvg-cuarentena` y `kvg-originales`. Se leen nombre, privacidad,
tamaño máximo y tipos MIME; no se consultan objetos almacenados, cuentas Auth,
sesiones ni filas de ninguna tabla `kvg`. Tampoco se cuentan perfiles operativos
para inferir si el bootstrap fue realizado.

## Interpretar los resultados

| Sección                              | Comparación esperada con la baseline                                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01_entorno`                         | PostgreSQL 15 o superior y transacción de solo lectura activa.                                                                                                                                                                |
| `02_esquemas_y_roles`                | Presencia de `public`, `kvg`, `kvg_privado`, `auth` y `storage`; roles `anon`, `authenticated` y `service_role`.                                                                                                              |
| `03_tablas`                          | 37 tablas KVG esperadas, sin nombres faltantes. Las tablas adicionales se informan para revisar su procedencia.                                                                                                               |
| `04_firmas_de_entrada`               | Presencia de las tres firmas exactas, retorno `jsonb` y `security_definer: true`.                                                                                                                                             |
| `05_acl_de_catalogo`                 | Propietarios, existencia de ACL explícita y concesiones de funciones, tablas, secuencias y esquemas, excluyendo las entradas del propietario.                                                                                 |
| `06_privilegios_efectivos_roles_app` | `authenticated` ejecuta `kvg_operar`; `service_role` ejecuta `kvg_trabajar`; ningún rol de aplicación ejecuta `kvg_inicializar`. Las listas de ejecución no esperada y acceso directo a tablas/secuencias deben estar vacías. |
| `07_rls_y_politicas`                 | 37 tablas con RLS habilitada y una política `lectura_controlada` por tabla. La baseline no fuerza RLS al propietario; una lista vacía de `tablas_con_force_rls` es normal en esa versión.                                     |
| `08_buckets_privados`                | Ambos buckets presentes y privados, límite 20 000 000 bytes y MIME PDF, DOCX, JPEG y PNG. El orden de los MIME no afecta la comparación.                                                                                      |

Las firmas exactas son:

```text
public.kvg_operar(text,jsonb)
public.kvg_trabajar(text,jsonb)
public.kvg_inicializar(uuid,uuid,text,text,text)
```

Las ACL se descomponen en privilegios individuales. `ACL_EXPLICITA` identifica
concesiones almacenadas en el catálogo. Si la ACL del objeto es nula, el informe
calcula las concesiones predeterminadas de PostgreSQL y las marca como
`PREDETERMINADA_POR_ACL_NULA`; una ACL nula no significa ausencia de privilegios.
`PUBLIC` representa a todos los roles. El informe omite las concesiones al
propietario, cuyos privilegios y capacidad administrativa deben interpretarse por
separado. La sección 06 consulta además los privilegios efectivos de los tres roles
de aplicación, incluyendo los que resulten de herencia o de concesiones a `PUBLIC`.

Si falta una función o un rol, las comprobaciones que dependen de él devuelven
`null`, no una aprobación. Las funciones adicionales que usen uno de los tres
nombres públicos también se incluyen en la inspección de privilegios para detectar
sobrecargas inesperadas. Las demás funciones de `public` quedan fuera del alcance.

Si el proyecto carece de `storage.buckets` o el rol del SQL Editor no puede leerlo,
la consulta falla y no produce un informe parcial. Registrar el error y confirmar
el proyecto y los permisos; no instalar ni borrar esquemas para intentar corregirlo.

## Límites de esta revisión

La presencia de tablas, firmas, políticas y permisos no demuestra que sus
definiciones coincidan con la baseline. El informe no compara cuerpos de funciones,
columnas, índices, restricciones, triggers, expresiones RLS ni la política de acceso
a los objetos de Storage. Tampoco revisa las pertenencias de todos los roles ni
pretende ser una auditoría completa de la plataforma.

Un resultado coincidente no demuestra conexión desde la API, validación del JWT,
MFA `aal2`, sesión operativa KVG, bootstrap, acceso real a un expediente o ejecución
del antimalware y los respaldos. Esas comprobaciones requieren los adaptadores y
pruebas con identidades autorizadas y datos ficticios descritos en
[las pruebas de integración pendientes](../tests/README.md).

El 28 de octubre de 2026 se ejecutó su consulta contra el proyecto configurado
mediante PostgreSQL 17.11, TLS validado y una transacción de solo lectura. Las ocho
secciones coincidieron con la baseline. La evidencia y las comprobaciones
adicionales están en [el informe de verificación](../../docs/supabase-verification.md).
Las discrepancias futuras deben revisarse antes de decidir una migración; no se modifica
`database/baseline/Modelo_Fisico_KVG_PostgreSQL.sql` ni se reinicializa una base
existente como parte del diagnóstico.

Referencias de PostgreSQL 15 para interpretar la consulta:

- [Funciones de información y privilegios](https://www.postgresql.org/docs/15/functions-info.html).
- [Transacciones de solo lectura](https://www.postgresql.org/docs/15/sql-set-transaction.html).
