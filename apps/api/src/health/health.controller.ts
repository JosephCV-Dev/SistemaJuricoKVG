import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@kvg/contracts';
import { Public } from '../modules/identity/presentation/access.decorators';

@Controller('health')
@Public()
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    // Liveness del proceso; no acredita conectividad con Supabase ni preparación de producción.
    return { status: 'ok', service: 'kvg-api', version: '0.1.0' };
  }
}
