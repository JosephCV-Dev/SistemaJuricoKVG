import {
  Injectable,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  BadGatewayException,
} from '@nestjs/common';
import type {
  DocumentUploadInput,
  DocumentVersionUploadInput,
} from '@kvg/contracts';
import { DocumentsRepository } from './documents.repository';
import { PrivateFiles } from './private-files.port';
import { DocumentUploadPolicy } from './document-upload-policy';
import { createHash } from 'node:crypto';
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

import { FILE_MIMES } from '../domain/document.types';
@Injectable()
export class DocumentsService {
  constructor(
    readonly repository: DocumentsRepository,
    private readonly files: PrivateFiles,
    readonly uploads: DocumentUploadPolicy,
  ) {}
  create(token: string, input: DocumentUploadInput) {
    this.uploads.assertEnabled();
    return this.repository.create(token, input);
  }
  createVersion(token: string, id: string, input: DocumentVersionUploadInput) {
    this.uploads.assertEnabled();
    return this.repository.createVersion(token, id, input);
  }
  async receive(token: string, id: string, bytes: Buffer) {
    this.uploads.assertEnabled();
    const status = await this.repository.upload(token, id); // Identidad y alcance ANTES del objeto técnico.
    const path = `cargas/${id}/original`;
    if (status.state !== 'RECIBIENDO') {
      if (
        digest(await this.files.read('kvg-cuarentena', path)) !== digest(bytes)
      )
        throw new ConflictException('El intento ya contiene otro archivo.');
      return status;
    }
    await this.files.authorizeReception(id);
    // MIME inferido solo para transporte; no habilita nada, el trabajador valida contenido real.
    const first = bytes.subarray(0, 8).toString('hex');
    const mime = first.startsWith('89504e47')
      ? FILE_MIMES.PNG
      : first.startsWith('ffd8')
        ? FILE_MIMES.JPG
        : first.startsWith('25504446')
          ? FILE_MIMES.PDF
          : FILE_MIMES.DOCX;
    await this.files.putImmutable('kvg-cuarentena', path, bytes, mime);
    await this.repository.upload(token, id); // Revisa revocación mientras se recibía.
    await this.files.completeReception(id, bytes.length);
    return this.repository.upload(token, id);
  }
  async download(token: string, versionId: string) {
    const auth = await this.repository.authorizeDownload(token, versionId);
    let destination = await this.files.authorizeDelivery(auth.id);
    if (destination.beta && !this.uploads.availability().beta)
      throw new ForbiddenException(
        'El archivo está disponible solo durante la beta.',
      );
    const path = destination.path;
    const bytes = await this.files.read('kvg-originales', path);
    if (
      bytes.length !== auth.size ||
      digest(bytes) !== auth.sha256 ||
      bytes.length !== destination.size
    )
      throw new ServiceUnavailableException(
        'El archivo no superó la comprobación de integridad.',
      );
    destination = await this.files.authorizeDelivery(auth.id);
    if (destination.path !== path) throw new BadGatewayException();
    return bytes; // Descarga como adjunto. Nunca URL pública, vista activa ni secreto.
  }
}
