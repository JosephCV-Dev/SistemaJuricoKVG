import { createHash } from 'node:crypto';
import {
  RejectedContent,
  type VerifiedFile,
} from '../../documents/domain/document.types';

export interface WorkerFiles {
  execute(operation: string, input: Record<string, unknown>): Promise<unknown>;
  read(
    bucket: 'kvg-cuarentena' | 'kvg-originales',
    path: string,
  ): Promise<Buffer>;
  putImmutable(
    bucket: 'kvg-cuarentena' | 'kvg-originales',
    path: string,
    bytes: Buffer,
    mime: string,
  ): Promise<void>;
}
export interface ContentVerifier {
  verify(bytes: Buffer, name: string): Promise<VerifiedFile>;
}
const obj = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error();
  return value as Record<string, unknown>;
};
const text = (value: unknown) => {
  if (typeof value !== 'string' || !value) throw new Error();
  return value;
};
const integer = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error();
  return value;
};
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
export class DocumentWorker {
  constructor(
    private readonly files: WorkerFiles,
    private readonly verifier: ContentVerifier,
  ) {}
  async once(): Promise<'idle' | 'published' | 'rejected' | 'retry'> {
    const job = obj(await this.files.execute('trabajo.tomar_carga', {}));
    if (!job.trabajo_id) return 'idle';
    const lease = {
      trabajo_id: text(job.trabajo_id),
      token: text(job.ejecutor_codigo),
    };
    // Renovación del lease durante análisis/transferencia; se confirma antes de publicar.
    const timer = setInterval(() => {
      void this.files.execute('trabajo.renovar', lease).catch(() => undefined);
    }, 60_000);
    timer.unref();
    try {
      const data = obj(await this.files.execute('trabajo.datos', lease));
      const upload = obj(data.carga);
      const source = text(upload.localizador_cuarentena),
        target = text(data.localizador_destino);
      const bytes = await this.files.read('kvg-cuarentena', source);
      if (bytes.length !== integer(upload.tamano_recibido_bytes))
        throw new RejectedContent('TAMANO_INCONSISTENTE');
      const verified = await this.verifier.verify(
        bytes,
        text(upload.nombre_original),
      );
      await this.files.execute('trabajo.renovar', lease);
      await this.files.putImmutable(
        'kvg-originales',
        target,
        bytes,
        verified.mime,
      );
      if (
        digest(await this.files.read('kvg-originales', target)) !==
        verified.sha256
      )
        throw new Error();
      await this.files.execute('carga.publicar', {
        ...lease,
        antimalware_apto: true,
        tamano_bytes: verified.size,
        sha256: verified.sha256,
        formato: verified.format,
        mime_verificado: verified.mime,
        motor_version: verified.engine,
      });
      return 'published';
    } catch (error) {
      if (error instanceof RejectedContent) {
        await this.files.execute('carga.rechazar', {
          ...lease,
          motor_version: 'kvg-verifier-v1; contenido rechazado',
        });
        return 'rejected';
      }
      await this.files.execute('trabajo.fallar', lease).catch(() => undefined);
      return 'retry';
    } finally {
      clearInterval(timer);
    }
  }
}
