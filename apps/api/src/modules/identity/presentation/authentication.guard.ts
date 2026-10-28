import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { IdentityService } from '../application/identity.service';
import {
  PUBLIC_ROUTE,
  REQUIRED_PERMISSION,
  SELF_AUTHENTICATED_ROUTE,
} from './access.decorators';
import { ServerSessions } from './server-sessions.service';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly logger = new Logger('AuthorizationSecurity');
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: ServerSessions,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlers = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, handlers))
      return true;
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    this.sessions.require(request);
    if (
      !request.session.authentication ||
      request.session.authentication.phase !== 'authenticated'
    ) {
      throw new UnauthorizedException('Se requiere una sesión autenticada.');
    }
    try {
      await this.sessions.exclusive(request, async () => {
        const authentication = request.session.authentication;
        if (!authentication || authentication.phase !== 'authenticated')
          throw new UnauthorizedException(
            'Se requiere una sesión autenticada.',
          );
        const result = await this.identity.state(authentication, (renewed) =>
          this.sessions.persistAuthentication(request, renewed),
        );
        if (!result.context || result.state.status !== 'authenticated')
          throw new UnauthorizedException(
            'Se requiere una sesión autenticada.',
          );
        this.sessions.assign(request, result.authentication);
        request.identity = result.context;
        await this.sessions.save(request);
      });
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        await this.sessions.destroy(request, response).catch(() => undefined);
        throw new UnauthorizedException('La sesión no es válida o ha vencido.');
      }
      throw error;
    }
    const required = this.reflector.getAllAndOverride<{
      permission: string;
      context: string | readonly string[];
    }>(REQUIRED_PERMISSION, handlers);
    if (required) {
      if (
        !request.identity?.capabilities.some(
          (capability) =>
            capability.permission === required.permission &&
            (typeof required.context === 'string'
              ? capability.context === required.context
              : required.context.includes(capability.context)),
        )
      ) {
        this.logger.warn(
          JSON.stringify({
            action: 'AUTORIZACION_DENEGADA',
            result: 'DENEGADO',
            actorId: request.identity?.user.id,
            permission: required.permission,
            correlationId: randomUUID(),
          }),
        );
        throw new ForbiddenException('Operación no autorizada.');
      }
      // El caso de uso y RPC siguen comprobando el recurso y su alcance exacto.
      return true;
    }
    if (
      !this.reflector.getAllAndOverride<boolean>(
        SELF_AUTHENTICATED_ROUTE,
        handlers,
      )
    ) {
      this.logger.warn(
        JSON.stringify({
          action: 'POLITICA_AUSENTE',
          result: 'DENEGADO',
          actorId: request.identity?.user.id,
          correlationId: randomUUID(),
        }),
      );
      throw new ForbiddenException(
        'La operación no tiene una política de acceso.',
      );
    }
    return true;
  }
}
