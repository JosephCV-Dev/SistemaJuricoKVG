import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'kvg:public';
export const SELF_AUTHENTICATED_ROUTE = 'kvg:self-authenticated';
export const REQUIRED_PERMISSION = 'kvg:required-permission';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Authenticated = () => SetMetadata(SELF_AUTHENTICATED_ROUTE, true);
export const RequirePermission = (permission: string, context: string) =>
  SetMetadata(REQUIRED_PERMISSION, { permission, context });
