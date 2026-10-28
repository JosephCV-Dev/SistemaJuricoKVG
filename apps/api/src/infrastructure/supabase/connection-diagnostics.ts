import type { Environment } from '../../config/environment';

export interface ConnectionCheck {
  component: 'Auth' | 'Data API';
  result: 'available' | 'restricted' | 'failed';
  status: number | null;
}

// Solo GET de servicios; no llama RPC, no consulta filas ni inspecciona objetos.
export async function checkSupabaseConnection(
  config: Environment,
): Promise<ConnectionCheck[]> {
  if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      'Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en apps/api/.env.',
    );
  }

  const checks: ConnectionCheck[] = [];
  for (const [component, path] of [
    ['Auth', '/auth/v1/settings'],
    ['Data API', '/rest/v1/'],
  ] as const) {
    try {
      const response = await fetch(`${config.SUPABASE_URL}${path}`, {
        method: 'GET',
        headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY },
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      await response.body?.cancel();
      const restricted =
        component === 'Data API' && [401, 403].includes(response.status);
      checks.push({
        component,
        result: response.ok
          ? 'available'
          : restricted
            ? 'restricted'
            : 'failed',
        status: response.status,
      });
    } catch {
      checks.push({ component, result: 'failed', status: null });
    }
  }
  return checks;
}
