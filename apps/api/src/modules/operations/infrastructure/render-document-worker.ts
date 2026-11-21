import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/environment';
import { DocumentUploadPolicy } from '../../documents/application/document-upload-policy';

@Injectable()
export class RenderDocumentWorker
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(RenderDocumentWorker.name);
  private child: ChildProcess | undefined;
  private retry?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly uploads: DocumentUploadPolicy,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.get('RENDER_DOCUMENT_WORKER', { infer: true })) return;
    const url = this.config.get('SUPABASE_URL', { infer: true });
    const key = this.config.get('SUPABASE_SECRET_KEY', { infer: true });
    if (!url || !key) {
      this.logger.warn('La beta documental requiere SUPABASE_SECRET_KEY.');
      return;
    }
    this.start(url, key);
  }

  private start(url: string, key: string) {
    const child = fork(
      join(__dirname, '../../../worker.js'),
      ['--render-demo'],
      {
        env: {
          PATH: process.env.PATH,
          NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
          NODE_ENV: 'production',
          RENDER: 'true',
          RENDER_SERVICE_TYPE: 'web',
          DOCUMENT_UPLOAD_MODE: 'beta',
          SUPABASE_URL: url,
          SUPABASE_SECRET_KEY: key,
        },
        execArgv: [],
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      },
    );
    this.child = child;
    child.on('message', (message) => {
      if (message === 'document-worker-ready' && !this.stopping) {
        this.uploads.setWorkerAvailable(true);
        this.logger.log('El trabajador de Render tiene acceso a la cola beta.');
      }
    });
    child.on('error', () => this.uploads.setWorkerAvailable(false));
    child.once('close', () => {
      this.child = undefined;
      this.uploads.setWorkerAvailable(false);
      if (this.stopping) return;
      this.logger.warn(
        'Trabajador beta no disponible. Revisa la activación SQL y la configuración técnica de Supabase.',
      );
      this.retry = setTimeout(() => this.start(url, key), 15_000);
    });
  }

  async beforeApplicationShutdown() {
    this.stopping = true;
    clearTimeout(this.retry);
    const child = this.child;
    if (!child) return;
    this.uploads.setWorkerAvailable(false);
    await new Promise<void>((resolve) => {
      child.once('close', resolve);
      child.kill('SIGTERM');
    });
  }
}
