import { createConnection } from 'node:net';
import { ServiceUnavailableException } from '@nestjs/common';
import { RejectedContent } from '../../documents/domain/document.types';
export class ClamAvScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}
  private command(command: string, bytes?: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      let response = '';
      const fail = () => {
        socket.destroy();
        reject(
          new ServiceUnavailableException(
            'El análisis antimalware no está disponible.',
          ),
        );
      };
      socket.setTimeout(60_000, fail);
      socket.on('error', fail);
      socket.on('data', (part: Buffer) => {
        response += part.toString();
        if (response.length > 4096) return fail();
        if (response.includes('\0')) {
          socket.end();
          resolve(response.replace(/\0.*$/s, ''));
        }
      });
      socket.on('end', () => {
        if (!response.includes('\0')) fail();
      });
      socket.on('connect', () => {
        socket.write(`z${command}\0`);
        if (bytes) {
          for (let offset = 0; offset < bytes.length; offset += 65536) {
            const chunk = bytes.subarray(offset, offset + 65536);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(chunk.length);
            socket.write(size);
            socket.write(chunk);
          }
          socket.write(Buffer.alloc(4));
        }
      });
    });
  }
  async scan(bytes: Buffer) {
    const version = await this.command('VERSION');
    const parts = version.split('/');
    const signatureDate = Date.parse(parts[2] ?? '');
    if (
      parts.length !== 3 ||
      !Number.isFinite(signatureDate) ||
      Date.now() - signatureDate > 7 * 86400_000 ||
      signatureDate > Date.now() + 86400_000
    )
      throw new ServiceUnavailableException(
        'Las firmas antimalware requieren actualización.',
      );
    const result = await this.command('INSTREAM', bytes);
    if (result.endsWith(' FOUND'))
      throw new RejectedContent('ANTIMALWARE_RECHAZADO');
    if (result !== 'stream: OK')
      throw new ServiceUnavailableException(
        'El análisis antimalware no concluyó.',
      );
    return version;
  }
}
