// Contratos HTTP públicos; importar siempre con `import type`.
// Las entidades de persistencia y los secretos permanecen en el backend.
export interface HealthResponse {
  status: 'ok';
  service: 'kvg-api';
  version: string;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  timestamp: string;
}
