import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import './session.types';

// Solo para controladores que ya pasaron AuthenticationGuard. Nunca desde un DTO.
export function userAccessToken(request: Request): string {
  if (
    !request.identity ||
    request.session.authentication?.phase !== 'authenticated'
  )
    throw new UnauthorizedException('Se requiere una sesión autenticada.');
  return request.session.authentication.accessToken;
}
