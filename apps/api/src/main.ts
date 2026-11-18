import 'reflect-metadata';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express, Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Environment } from './config/environment';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  if (process.argv.includes('--serve-web')) {
    const web = resolve(__dirname, '../../web/dist');
    await access(resolve(web, 'index.html'));
    app.useStaticAssets(web, { dotfiles: 'deny', redirect: false });
    const server = app.getHttpAdapter().getInstance() as Express;
    // La activación usa una URL directa; el espacio de trabajo navega en memoria.
    server.get('/activar-cuenta', (_request: Request, response: Response) =>
      response.sendFile('index.html', { root: web }),
    );
  }
  const config = app.get(ConfigService<Environment, true>);
  await app.listen(
    config.get('API_PORT', { infer: true }),
    config.get('API_HOST', { infer: true }),
  );
}

void bootstrap().catch(() => {
  Logger.error(
    'No se pudo iniciar la API. Revisa la configuración y el puerto.',
    'Bootstrap',
  );
  process.exitCode = 1;
});
