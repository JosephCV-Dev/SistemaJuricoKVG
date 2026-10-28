import type { HealthResponse } from '@kvg/contracts';

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'ok' &&
    'service' in value &&
    value.service === 'kvg-api' &&
    'version' in value &&
    typeof value.version === 'string'
  );
}

export async function getHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/v1/health', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    signal,
  });

  if (!response.ok) {
    throw new Error(`La API respondió con el estado HTTP ${response.status}.`);
  }

  const payload: unknown = await response.json();

  if (!isHealthResponse(payload)) {
    throw new Error(
      'La respuesta de salud de la API tiene un formato inesperado.',
    );
  }

  return payload;
}
