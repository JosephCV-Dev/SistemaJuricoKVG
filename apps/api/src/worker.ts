import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { validateWorkerEnvironment } from './config/worker-environment';
import { documentUploadMode } from './config/document-upload-mode';
import { PrivateFileGateway } from './modules/documents/infrastructure/private-file-gateway';
import { DocumentWorker } from './modules/operations/application/document-worker';
import { IsolatedFileVerifier } from './modules/operations/infrastructure/isolated-file-verifier';

async function run() {
  const renderDemo =
    process.argv.includes('--render-demo') && process.connected === true;
  if (!renderDemo) {
    try {
      process.loadEnvFile('.env');
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
    }
  }
  const mode = documentUploadMode(process.env, renderDemo);
  if (mode === 'paused') {
    console.log('Cargas pausadas: no se reclaman ni procesan trabajos.');
    return;
  }
  const env = validateWorkerEnvironment(process.env);
  const worker = new DocumentWorker(
    new PrivateFileGateway(new ConfigService(env)),
    new IsolatedFileVerifier(env.CLAMAV_HOST, env.CLAMAV_PORT, mode === 'beta'),
    mode === 'beta',
  );
  let stopping = false;
  let announced = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  if (renderDemo) process.once('disconnect', stop);
  do {
    const result = await worker.once();
    if (result !== 'idle' || process.argv.includes('--once'))
      console.log(JSON.stringify({ action: 'DOCUMENT_WORKER', result }));
    const recovery = stopping ? 'idle' : await worker.recoverOnce();
    if (recovery !== 'idle' || process.argv.includes('--once'))
      console.log(
        JSON.stringify({
          action: 'DOCUMENT_RECOVERY_WORKER',
          result: recovery,
        }),
      );
    if (renderDemo && !announced && !stopping && process.connected) {
      announced = true;
      process.send?.('document-worker-ready', undefined, undefined, (error) => {
        if (error) stop();
      });
    }
    if (process.argv.includes('--once')) break;
    if (
      !stopping &&
      (result === 'idle' || result === 'retry') &&
      (recovery === 'idle' || recovery === 'retry')
    )
      await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (!stopping);
}
void run()
  .catch(() => {
    console.error(
      'El trabajador no pudo continuar. Revisa su configuración privada y conectividad.',
    );
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.connected) process.disconnect?.();
  });
