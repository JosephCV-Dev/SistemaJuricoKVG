import { existsSync } from 'node:fs';
import { validateEnvironment } from '../dist/config/environment.js';
import { checkSupabaseConnection } from '../dist/infrastructure/supabase/connection-diagnostics.js';

try {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = validateEnvironment(process.env);
  const checks = await checkSupabaseConnection(config);
  const labels = {
    available: 'accesible',
    restricted: 'acceso restringido; requiere comprobación adicional',
    failed: 'falló la comprobación',
  };
  for (const check of checks) {
    console.log(
      `${check.component}: ${labels[check.result]} (HTTP ${check.status ?? 'sin respuesta'}).`,
    );
  }
  console.log(
    'Este diagnóstico solo comprueba conectividad. Esquema, privilegios, Storage y sesiones requieren verificaciones separadas.',
  );
  if (checks.some((check) => check.result === 'failed')) process.exitCode = 1;
} catch (error) {
  // No imprimir respuestas, URL, claves ni detalles de errores de red.
  console.error(
    error instanceof Error && error.message.startsWith('Configura ')
      ? error.message
      : 'No se pudo ejecutar el diagnóstico. Revisa las variables de configuración.',
  );
  process.exitCode = 1;
}
