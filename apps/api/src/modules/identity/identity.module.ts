import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { Environment } from '../../config/environment';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import {
  IdentityProvider,
  OperationalSession,
} from './application/identity.ports';
import { IdentityService } from './application/identity.service';
import { SupabaseIdentityProvider } from './infrastructure/supabase-identity.provider';
import { KvgOperationalSession } from './infrastructure/kvg-operational-session';
import { createServerSession } from './infrastructure/server-session';
import { AuthController } from './presentation/auth.controller';
import {
  ServerSessions,
  SERVER_SESSION_RUNTIME,
} from './presentation/server-sessions.service';
import { CsrfGuard } from './presentation/csrf.guard';
import { AuthRateLimitGuard } from './presentation/auth-rate-limit.guard';
import { AuthenticationGuard } from './presentation/authentication.guard';

@Module({
  imports: [ConfigModule, SupabaseModule],
  controllers: [AuthController],
  providers: [
    {
      provide: SERVER_SESSION_RUNTIME,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment>) =>
        createServerSession({
          databaseUrl: config.get('SESSION_DATABASE_URL', { infer: true }),
          secret: config.get('SESSION_SECRET', { infer: true }),
          encryptionKey: config.get('SESSION_ENCRYPTION_KEY', { infer: true }),
          production: config.get('NODE_ENV', { infer: true }) === 'production',
          trustProxy: config.get('TRUST_PROXY', { infer: true }),
        }),
    },
    { provide: IdentityProvider, useClass: SupabaseIdentityProvider },
    { provide: OperationalSession, useClass: KvgOperationalSession },
    IdentityService,
    ServerSessions,
    CsrfGuard,
    AuthRateLimitGuard,
    { provide: APP_GUARD, useClass: AuthenticationGuard },
  ],
  exports: [ServerSessions, IdentityService, CsrfGuard],
})
export class IdentityModule {}
