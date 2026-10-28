import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@kvg/contracts';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    // Liveness del proceso; no acredita conectividad con Supabase ni preparación de producción.
    return { status: 'ok', service: 'kvg-api', version: '0.1.0' };
  }
}
