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
type Lease = { trabajo_id: string; token: string };
export class DocumentWorker {
  constructor(
    private readonly files: WorkerFiles,
    private readonly verifier: ContentVerifier,
    private readonly beta = false,
  ) {}
  async once(): Promise<
    'idle' | 'published' | 'rejected' | 'cancelled' | 'retry'
  > {
    const job = obj(
      await this.files.execute(
        this.beta ? 'trabajo.tomar_carga_beta' : 'trabajo.tomar_carga',
        {},
      ),
    );
    if (!job.trabajo_id) return 'idle';
    const lease = {
      trabajo_id: text(job.trabajo_id),
      token: text(job.ejecutor_codigo),
    };
    // Renovación del lease durante análisis/transferencia; se confirma antes de publicar.
    const timer = this.keepLease(lease);
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
      if (this.beta ? verified.engine !== null : !verified.engine)
        throw new Error();
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
      const publication = obj(
        await this.files.execute(
          this.beta ? 'carga.publicar_beta' : 'carga.publicar',
          {
            ...lease,
            ...(this.beta
              ? {}
              : { antimalware_apto: true, motor_version: verified.engine }),
            tamano_bytes: verified.size,
            sha256: verified.sha256,
            formato: verified.format,
            mime_verificado: verified.mime,
          },
        ),
      );
      if (publication.estado === 'CANCELADO') return 'cancelled';
      text(publication.version_id);
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

  async recoverOnce(): Promise<
    'idle' | 'recovered' | 'rejected' | 'cancelled' | 'retry'
  > {
    const job = obj(await this.files.execute('trabajo.tomar_recuperacion', {}));
    if (!job.trabajo_id) return 'idle';
    const lease = {
      trabajo_id: text(job.trabajo_id),
      token: text(job.ejecutor_codigo),
    };
    const timer = this.keepLease(lease);
    try {
      const data = obj(await this.files.execute('trabajo.datos', lease));
      if (data.autorizada === false) return await this.rejectRecovery(lease);
      if (data.autorizada !== true || !Array.isArray(data.originales))
        throw new Error();
      if (!data.originales.length) throw new RejectedContent();
      const evidence = [];
      for (const original of data.originales)
        evidence.push(await this.verifyOriginal(obj(original)));
      await this.files.execute('trabajo.renovar', lease);
      const result = obj(
        await this.files.execute(
          this.beta ? 'documento.recuperar_beta' : 'documento.recuperar',
          { ...lease, verificaciones: evidence },
        ),
      );
      switch (result.estado) {
        case 'COMPLETADO':
          return 'recovered';
        case 'FALLIDO':
          return 'rejected';
        case 'CANCELADO':
          return 'cancelled';
        default:
          throw new Error();
      }
    } catch (error) {
      if (error instanceof RejectedContent) {
        const rejected = await this.rejectRecovery(lease).catch(() => null);
        if (rejected) return rejected;
      }
      await this.files.execute('trabajo.fallar', lease).catch(() => undefined);
      return 'retry';
    } finally {
      clearInterval(timer);
    }
  }

  private keepLease(lease: Lease) {
    const timer = setInterval(() => {
      void this.files.execute('trabajo.renovar', lease).catch(() => undefined);
    }, 60_000);
    timer.unref();
    return timer;
  }

  private async rejectRecovery(lease: Lease) {
    const result = obj(
      await this.files.execute('recuperacion.rechazar', lease),
    );
    if (result.estado === 'FALLIDO') return 'rejected';
    if (result.estado === 'CANCELADO') return 'cancelled';
    throw new Error();
  }

  private async verifyOriginal(original: Record<string, unknown>) {
    if (original.habilitado === false || original.objeto_id === null)
      throw new RejectedContent();
    if (original.bucket !== 'kvg-originales' || original.habilitado !== true)
      throw new Error();
    const expectedHash = text(original.sha256);
    const expectedSize = integer(original.tamano_bytes);
    const bytes = await this.files.read(
      'kvg-originales',
      text(original.localizador),
    );
    if (bytes.length !== expectedSize || digest(bytes) !== expectedHash)
      throw new RejectedContent();
    const verified = await this.verifier.verify(
      bytes,
      text(original.nombre_original),
    );
    if (
      verified.sha256 !== expectedHash ||
      verified.size !== expectedSize ||
      (this.beta ? verified.engine !== null : !verified.engine)
    )
      throw new Error();
    return {
      version_id: text(original.version_id),
      sha256: verified.sha256,
      tamano_bytes: verified.size,
      objeto_id: text(original.objeto_id),
      objeto_revision: text(original.objeto_revision),
      ...(this.beta ? {} : { antimalware_apto: true }),
    };
  }
}
