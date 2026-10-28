import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Environment } from '../../../config/environment';
import { ServerSessions } from './server-sessions.service';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<Environment>,
    private readonly sessions: ServerSessions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    this.sessions.require(request);
    const origin = request.get('origin');
    const supplied = request.get('x-csrf-token');
    const expected = request.session.csrfToken;
    const providedBytes = Buffer.from(supplied ?? '');
    const expectedBytes = Buffer.from(expected ?? '');
    if (
      origin !== this.config.get('APP_ORIGIN', { infer: true }) ||
      !supplied ||
      !expected ||
      providedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(providedBytes, expectedBytes)
    ) {
      throw new ForbiddenException(
        'La petición no superó la verificación de origen y CSRF.',
      );
    }
    return true;
  }
}
