import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  RejectedContent,
  type VerifiedFile,
  FILE_MIMES,
} from '../../documents/domain/document.types';
import { createHash } from 'node:crypto';
export class IsolatedFileVerifier {
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}
  verify(bytes: Buffer, name: string): Promise<VerifiedFile> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--max-old-space-size=384', join(__dirname, 'verify-file-process.js')],
        {
          env: {
            PATH: process.env.PATH,
            CLAMAV_HOST: this.host,
            CLAMAV_PORT: String(this.port),
            KVG_FILE_NAME: name,
          },
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      );
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('ANALISIS_AGOTADO'));
      }, 90_000);
      let result = '';
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('ANALISIS_NO_DISPONIBLE'));
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(bytes);
      child.stdout.on('data', (chunk: Buffer) => {
        result += chunk.toString();
        if (result.length > 4096) child.kill('SIGKILL');
      });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(result) as {
            status: string;
            verified?: VerifiedFile;
          };
          if (parsed.status === 'rejected')
            return reject(new RejectedContent());
          const v = parsed.verified;
          if (
            parsed.status !== 'verified' ||
            !v ||
            v.size !== bytes.length ||
            v.sha256 !== createHash('sha256').update(bytes).digest('hex') ||
            !Object.hasOwn(FILE_MIMES, v.format) ||
            v.mime !== FILE_MIMES[v.format] ||
            typeof v.engine !== 'string'
          )
            throw new Error();
          resolve(v);
        } catch {
          reject(new Error('ANALISIS_NO_DISPONIBLE'));
        }
      });
    });
  }
}
