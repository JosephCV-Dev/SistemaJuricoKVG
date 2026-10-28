import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly windows = new Map<
    string,
    { count: number; until: number }
  >();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const email =
      typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';
    const account = email
      ? createHash('sha256').update(email).digest('hex')
      : request.sessionID;
    const now = Date.now();
    for (const [key, window] of this.windows)
      if (window.until <= now) this.windows.delete(key);
    if (this.windows.size >= 10_000)
      throw new HttpException('Demasiados intentos. Intenta más tarde.', 429);
    for (const [key, limit] of [
      [`ip:${request.ip}`, 30],
      [`account:${account}:${request.path}`, 10],
    ] as const) {
      const window = this.windows.get(key) ?? {
        count: 0,
        until: now + 5 * 60_000,
      };
      window.count++;
      this.windows.set(key, window);
      if (window.count > limit)
        throw new HttpException('Demasiados intentos. Intenta más tarde.', 429);
    }
    return true;
  }
}
