import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { validateWorkerEnvironment } from './config/worker-environment';
import { documentUploadMode } from './config/document-upload-mode';
import { PrivateFileGateway } from './modules/documents/infrastructure/private-file-gateway';
import { DocumentWorker } from './modules/operations/application/document-worker';
import { IsolatedFileVerifier } from './modules/operations/infrastructure/isolated-file-verifier';

async function run() {
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  if (documentUploadMode(process.env) === 'paused') {
    console.log('Cargas pausadas: no se reclaman ni procesan trabajos.');
    return;
  }
  const env = validateWorkerEnvironment(process.env);
  const worker = new DocumentWorker(
    new PrivateFileGateway(new ConfigService(env)),
    new IsolatedFileVerifier(env.CLAMAV_HOST, env.CLAMAV_PORT),
  );
  let stopping = false;
  process.on('SIGTERM', () => {
    stopping = true;
  });
  process.on('SIGINT', () => {
    stopping = true;
  });
  do {
    const result = await worker.once();
    console.log(JSON.stringify({ action: 'DOCUMENT_WORKER', result }));
    if (process.argv.includes('--once')) break;
    if (result === 'idle' || result === 'retry')
      await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (!stopping);
}
void run().catch(() => {
  console.error(
    'El trabajador no pudo continuar. Revisa su configuración privada y conectividad.',
  );
  process.exitCode = 1;
});
