import { ServiceUnavailableException } from '@nestjs/common';
import type { DocumentUploadAvailability } from '@kvg/contracts';

export class DocumentUploadPolicy {
  constructor(
    private readonly mode: 'paused' | 'verified' | 'beta' = 'paused',
    private workerAvailable = true,
  ) {}

  setWorkerAvailable(available: boolean) {
    this.workerAvailable = available;
  }

  availability(): DocumentUploadAvailability {
    return {
      enabled: this.mode !== 'paused' && this.workerAvailable,
      ...(this.mode === 'beta' ? { beta: true } : {}),
    };
  }

  assertEnabled() {
    if (!this.availability().enabled)
      throw new ServiceUnavailableException(
        'Las cargas están pausadas hasta habilitar la verificación de archivos.',
      );
  }
}
