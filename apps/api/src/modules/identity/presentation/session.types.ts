import type { IdentityContext, Authentication } from '../domain/identity.types';

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    authentication?: Authentication;
    invitation?: { accessToken: string; digest: string; expiresAt: number };
  }
}

declare global {
  namespace Express {
    interface Request {
      identity?: IdentityContext;
    }
  }
}
