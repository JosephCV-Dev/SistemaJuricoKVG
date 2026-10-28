import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { ServerSessionRuntime } from '../infrastructure/server-session';
import type { Authentication } from '../domain/identity.types';
import './session.types';

export const SERVER_SESSION_RUNTIME = Symbol('SERVER_SESSION_RUNTIME');

@Injectable()
export class ServerSessions implements OnModuleDestroy {
  constructor(
    @Inject(SERVER_SESSION_RUNTIME)
    readonly runtime: ServerSessionRuntime | null,
  ) {}

  require(request: Request): void {
    if (!this.runtime || !request.session)
      throw new ServiceUnavailableException('El acceso no está configurado.');
  }

  async save(request: Request): Promise<void> {
    this.require(request);
    await new Promise<void>((resolve, reject) =>
      request.session.save((error: unknown) =>
        error
          ? reject(
              new ServiceUnavailableException(
                'No fue posible guardar la sesión.',
              ),
            )
          : resolve(),
      ),
    );
  }

  async csrf(request: Request): Promise<string> {
    this.require(request);
    // Una lectura con un snapshot antiguo no debe sobrescribir tokens renovados.
    if (request.session.csrfToken) return request.session.csrfToken;
    if (request.session.authentication) {
      return this.exclusive(request, async () => {
        request.session.csrfToken ??= randomBytes(32).toString('base64url');
        await this.save(request);
        return request.session.csrfToken!;
      });
    }
    request.session.csrfToken ??= randomBytes(32).toString('base64url');
    await this.save(request);
    return request.session.csrfToken;
  }

  async exclusive<T>(request: Request, action: () => Promise<T>): Promise<T> {
    this.require(request);
    return this.runtime!.store.withLock(request.sessionID, async () => {
      await new Promise<void>((resolve, reject) =>
        request.session.reload((error: unknown) =>
          error
            ? reject(
                new UnauthorizedException(
                  'La sesión no es válida o ha vencido.',
                ),
              )
            : resolve(),
        ),
      );
      return action();
    });
  }

  async rotate(
    request: Request,
    authentication: Authentication,
  ): Promise<void> {
    this.require(request);
    await new Promise<void>((resolve, reject) =>
      request.session.regenerate((error: unknown) =>
        error
          ? reject(
              new ServiceUnavailableException(
                'No fue posible renovar la sesión.',
              ),
            )
          : resolve(),
      ),
    );
    request.session.csrfToken = randomBytes(32).toString('base64url');
    this.assign(request, authentication);
    await this.save(request);
  }

  assign(request: Request, authentication: Authentication): void {
    request.session.authentication = authentication;
    request.session.cookie.maxAge = Math.max(
      1,
      Math.min(8 * 60 * 60_000, authentication.absoluteExpiresAt - Date.now()),
    );
  }

  async persistAuthentication(
    request: Request,
    authentication: Authentication,
  ): Promise<void> {
    this.assign(request, authentication);
    await this.save(request);
  }

  async destroy(request: Request, response?: Response): Promise<void> {
    this.require(request);
    await new Promise<void>((resolve, reject) =>
      request.session.destroy((error: unknown) =>
        error
          ? reject(
              new ServiceUnavailableException(
                'No fue posible cerrar la sesión local.',
              ),
            )
          : resolve(),
      ),
    );
    response?.clearCookie(this.runtime!.cookieName, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: this.runtime!.cookieName.startsWith('__Host-'),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.runtime?.store.close();
  }
}
