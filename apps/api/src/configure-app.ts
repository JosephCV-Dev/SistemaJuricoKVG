import { ValidationPipe, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ConfigService } from '@nestjs/config';
import type { Environment } from './config/environment';
import { ServerSessions } from './modules/identity/presentation/server-sessions.service';
import type { Express, Request, Response, NextFunction } from 'express';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  const config = app.get(ConfigService<Environment>);
  const server = app.getHttpAdapter().getInstance() as Express;
  server.set(
    'trust proxy',
    config.get('TRUST_PROXY', { infer: true }) ? 1 : false,
  );
  server.disable('x-powered-by');
  app.use(helmet());
  app.use(
    '/api/v1',
    (_request: Request, response: Response, next: NextFunction) => {
      response.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  const sessions = app.get(ServerSessions);
  if (sessions.runtime) app.use(sessions.runtime.middleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
}
