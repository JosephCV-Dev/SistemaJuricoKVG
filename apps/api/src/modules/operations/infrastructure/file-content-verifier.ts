import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { XMLValidator } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import {
  FILE_MIMES,
  MAX_FILE_BYTES,
  RejectedContent,
  type VerifiedFile,
  type FileFormat,
} from '../../documents/domain/document.types';
import { ClamAvScanner } from './clamav-scanner';

export class FileContentVerifier {
  constructor(private readonly scanner: ClamAvScanner) {}
  async verify(bytes: Buffer, name: string): Promise<VerifiedFile> {
    if (!bytes.length || bytes.length > MAX_FILE_BYTES)
      throw new RejectedContent('TAMANO_INVALIDO');
    const engine = await this.scanner.scan(bytes); // Falla cerrada; no usa el resultado del navegador.
    let format: FileFormat;
    try {
      const header = bytes.subarray(0, 8).toString('hex');
      if (header.startsWith('255044462d')) {
        const pdf = await PDFDocument.load(bytes, {
          updateMetadata: false,
          throwOnInvalidObject: true,
        });
        if (pdf.isEncrypted || pdf.getPageCount() < 1) throw new Error();
        format = 'PDF';
      } else if (header === '89504e470d0a1a0a' || header.startsWith('ffd8ff')) {
        const image = sharp(bytes, {
          failOn: 'warning',
          limitInputPixels: 40_000_000,
          animated: false,
        });
        const meta = await image.metadata();
        if (
          !['png', 'jpeg'].includes(meta.format ?? '') ||
          (meta.pages ?? 1) > 1
        )
          throw new Error();
        await image.raw().toBuffer();
        format = meta.format === 'png' ? 'PNG' : 'JPG';
      } else if (header.startsWith('504b0304')) {
        await verifyDocx(bytes);
        format = 'DOCX';
      } else throw new Error();
      const extension = name.split('.').pop()?.toLowerCase();
      if (
        !{ PDF: ['pdf'], DOCX: ['docx'], PNG: ['png'], JPG: ['jpg', 'jpeg'] }[
          format
        ].includes(extension ?? '')
      )
        throw new Error();
    } catch {
      throw new RejectedContent('FORMATO_INVALIDO');
    }
    return {
      format,
      mime: FILE_MIMES[format],
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      engine: `kvg-verifier-v1; ${engine}`,
    };
  }
}
function verifyDocx(bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) return reject(new Error());
        let count = 0,
          total = 0;
        const names = new Set<string>();
        const fail = () => {
          zip.close();
          reject(new Error());
        };
        zip.on('error', fail);
        zip.on('end', () => {
          if (
            !['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].every(
              (name) => names.has(name),
            )
          )
            return fail();
          resolve();
        });
        zip.on('entry', (entry: yauzl.Entry) => {
          const name = entry.fileName;
          if (
            ++count > 2000 ||
            names.has(name) ||
            name.includes('..') ||
            name.startsWith('/') ||
            (entry.generalPurposeBitFlag & 1) !== 0 ||
            /vbaProject|activeX|embeddings/i.test(name)
          )
            return fail();
          names.add(name);
          total += entry.uncompressedSize;
          if (total > 80_000_000 || entry.uncompressedSize > 20_000_000)
            return fail();
          if (name.endsWith('/')) return zip.readEntry();
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) return fail();
            let length = 0;
            const chunks: Buffer[] = [];
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => {
              length += chunk.length;
              if (length > 20_000_000) {
                stream.destroy();
                fail();
              } else if (/\.(xml|rels)$/.test(name)) chunks.push(chunk);
            });
            stream.on('end', () => {
              if (length !== entry.uncompressedSize) return fail();
              if (chunks.length) {
                const xml = Buffer.concat(chunks).toString('utf8');
                if (
                  /<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External/i.test(
                    xml,
                  ) ||
                  XMLValidator.validate(xml) !== true
                )
                  return fail();
                if (
                  name === 'word/document.xml' &&
                  !/wordprocessingml\/2006\/main/.test(xml)
                )
                  return fail();
                if (
                  name === '[Content_Types].xml' &&
                  !xml.includes(
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
                  )
                )
                  return fail();
              }
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
