import {
  Injectable,
  ServiceUnavailableException,
  BadGatewayException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { PrivateFiles } from '../application/private-files.port';
import {
  rpcRecord,
  rpcText,
  rpcInteger,
} from '../../../infrastructure/supabase/rpc-result';
import { MAX_FILE_BYTES } from '../domain/document.types';

// Solo RPC técnico/objetos privados. Nunca crea/consulta negocio en nombre del usuario.
@Injectable()
export class PrivateFileGateway extends PrivateFiles {
  constructor(private readonly config: ConfigService) {
    super();
  }
  async authorizeReception(id: string) {
    const r = rpcRecord(await this.execute('carga.destino', { carga_id: id }));
    if (
      r.bucket !== 'kvg-cuarentena' ||
      rpcText(r.localizador) !== `cargas/${id}/original`
    )
      throw new BadGatewayException();
  }
  async completeReception(id: string, size: number) {
    await this.execute('carga.recibir', { carga_id: id, tamano_bytes: size });
  }
  async authorizeDelivery(id: string) {
    const r = rpcRecord(
      await this.execute('entrega.autorizar', { autorizacion_id: id }),
    );
    if (r.bucket !== 'kvg-originales') throw new BadGatewayException();
    return { path: rpcText(r.localizador), size: rpcInteger(r.tamano_bytes) };
  }
  private client(): SupabaseClient {
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_SECRET_KEY');
    if (!url || !key)
      throw new ServiceUnavailableException(
        'La transferencia privada no está configurada.',
      );
    return createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: { retry: false },
      global: {
        fetch: (url, init) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
      },
    });
  }
  async execute(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      const r = await this.client().rpc('kvg_trabajar', {
        p_operacion: operation,
        p_datos: input,
      });
      if (r.error) throw new Error();
      return r.data as unknown;
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo completar el trabajo técnico privado.',
      );
    }
  }
  async read(
    bucket: 'kvg-cuarentena' | 'kvg-originales',
    path: string,
  ): Promise<Buffer> {
    // Respuesta acotada incluso si los metadatos remotos fueran incoherentes.
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_SECRET_KEY');
    if (!url || !key)
      throw new ServiceUnavailableException(
        'Transferencia privada no configurada.',
      );
    try {
      const r = await fetch(
        `${url}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!r.ok || !r.body) throw new Error();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of r.body) {
        size += c.length;
        if (size > MAX_FILE_BYTES) {
          await r.body.cancel().catch(() => undefined);
          throw new Error();
        }
        chunks.push(Buffer.from(c));
      }
      return Buffer.concat(chunks);
    } catch {
      throw new BadGatewayException('No se pudo verificar el archivo privado.');
    }
  }
  async putImmutable(
    bucket: 'kvg-cuarentena' | 'kvg-originales',
    path: string,
    bytes: Buffer,
    mime: string,
  ) {
    const r = await this.client()
      .storage.from(bucket)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (!r.error) return;
    // Recuperación tras respuesta perdida. No sobrescribe originales ni cuarentena.
    if (!['409', '400'].includes(String(r.error.statusCode)))
      throw new ServiceUnavailableException(
        'No se pudo almacenar el archivo privado.',
      );
    const previous = await this.read(bucket, path);
    if (digest(previous) !== digest(bytes))
      throw new ConflictException(
        'El intento ya contiene otro archivo. Inicia una carga nueva.',
      );
  }
}
export const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
