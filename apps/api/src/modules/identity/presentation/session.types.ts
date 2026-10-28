import type { IdentityContext, Authentication } from '../domain/identity.types';

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    authentication?: Authentication;
  }
}

declare global {
  namespace Express {
    interface Request {
      identity?: IdentityContext;
    }
  }
}
