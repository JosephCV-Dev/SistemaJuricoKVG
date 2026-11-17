import { readFileSync } from 'node:fs';

export const API_SECRET_NAMES = [
  'SUPABASE_SECRET_KEY',
  'SESSION_DATABASE_URL',
  'SESSION_SECRET',
  'SESSION_ENCRYPTION_KEY',
] as const;

// Solo archivos elegidos por el operador; nunca rutas recibidas por HTTP.
export function readRuntimeSecrets(
  input: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> {
  const result = { ...input };
  for (const name of names) {
    const path = input[`${name}_FILE`];
    if (path === undefined || path === '') continue;
    if (input[name] !== undefined && input[name] !== '')
      throw new Error(`Configura ${name} o ${name}_FILE, no ambas.`);
    if (typeof path !== 'string' || !path.startsWith('/'))
      throw new Error(`${name}_FILE debe ser una ruta absoluta.`);
    try {
      const content = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
      if (!content || content.length > 16384 || /[\r\n\0]/.test(content))
        throw new Error();
      result[name] = content;
    } catch {
      throw new Error(`No se pudo leer el archivo privado de ${name}.`);
    }
  }
  return result;
}
