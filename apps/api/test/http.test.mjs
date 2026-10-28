import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { validateEnvironment } from '../dist/config/environment.js';

let app;
let origin;

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});

after(async () => {
  await app?.close();
});

test('la API responde con el contrato HTTP usado por la interfaz', async () => {
  const response = await fetch(`${origin}/api/v1/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'kvg-api',
    version: '0.1.0',
  });
});

test('una ruta inexistente responde 404 en el formato común sin stack', async () => {
  const response = await fetch(`${origin}/api/v1/missing`);
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.statusCode, 404);
  assert.equal(typeof body.message, 'string');
  assert.ok(Number.isFinite(Date.parse(body.timestamp)));
  assert.equal('stack' in body, false);
});

test('rechaza configuración inválida antes de abrir el servicio', () => {
  for (const API_PORT of ['0', '65536', '3000oops', '1.5', '']) {
    assert.throws(() => validateEnvironment({ API_PORT }), /API_PORT/);
  }
  assert.throws(() => validateEnvironment({ NODE_ENV: 'invalid' }), /NODE_ENV/);
});
