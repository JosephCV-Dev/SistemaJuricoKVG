-- Persistencia técnica de sesiones web. Ejecutar como propietario una sola vez.
-- No modifica la baseline KVG ni crea usuarios de Supabase Auth.
-- El rol se crea sin contraseña: aprovisionarla por un canal local separado.
BEGIN;
SET LOCAL search_path = pg_catalog;

CREATE ROLE kvg_session_store WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8 PASSWORD NULL;

CREATE SCHEMA kvg_servidor;
REVOKE ALL ON SCHEMA kvg_servidor FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE kvg_servidor.sesion_web (
  sid_hash varchar(64) PRIMARY KEY CHECK (sid_hash ~ '^[0-9a-f]{64}$'),
  payload bytea,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT ck_sesion_web_payload CHECK (
    (revoked_at IS NULL AND payload IS NOT NULL AND octet_length(payload) BETWEEN 30 AND 1048576)
    OR (revoked_at IS NOT NULL AND payload IS NULL)
  ),
  CONSTRAINT ck_sesion_web_duracion CHECK (expires_at <= created_at + interval '8 hours')
);
CREATE INDEX ix_sesion_web_expiracion ON kvg_servidor.sesion_web (expires_at);

REVOKE ALL ON TABLE kvg_servidor.sesion_web FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA kvg_servidor TO kvg_session_store;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE kvg_servidor.sesion_web TO kvg_session_store;
ALTER TABLE kvg_servidor.sesion_web ENABLE ROW LEVEL SECURITY;
CREATE POLICY persistencia_sesion_web ON kvg_servidor.sesion_web
  FOR ALL TO kvg_session_store USING (true) WITH CHECK (true);

ALTER DEFAULT PRIVILEGES IN SCHEMA kvg_servidor
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA kvg_servidor
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE kvg_servidor.sesion_web IS
  'Carga AES-256-GCM vinculada al hash SHA-256 del SID; no almacena tokens ni SID en texto claro. Revocaciones conservan una marca sin carga para impedir resurrecciones concurrentes.';
COMMENT ON ROLE kvg_session_store IS
  'Persistencia técnica de sesión web; sin membresías ni concesiones KVG/Auth/Storage. La clave de cifrado reside solo en el proceso servidor.';

COMMIT;
