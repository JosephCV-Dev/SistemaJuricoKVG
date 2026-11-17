import { ServiceUnavailableException } from '@nestjs/common';
import type { DocumentUploadAvailability } from '@kvg/contracts';

export class DocumentUploadPolicy {
  constructor(private readonly mode: 'paused' | 'verified' = 'paused') {}

  availability(): DocumentUploadAvailability {
    return { enabled: this.mode === 'verified' };
  }

  assertEnabled() {
    if (!this.availability().enabled)
      throw new ServiceUnavailableException(
        'Las cargas están pausadas hasta habilitar la verificación de archivos.',
      );
  }
}
