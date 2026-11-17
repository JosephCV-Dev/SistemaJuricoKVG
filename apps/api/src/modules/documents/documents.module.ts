import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentUploadPolicy } from './application/document-upload-policy';
import { IdentityModule } from '../identity/identity.module';
import { SupabaseModule } from '../../infrastructure/supabase/supabase.module';
import { DocumentsController } from './presentation/documents.controller';
import { DocumentsService } from './application/documents.service';
import { DocumentsRepository } from './application/documents.repository';
import { PrivateFiles } from './application/private-files.port';
import { KvgDocumentsRepository } from './infrastructure/kvg-documents.repository';
import { PrivateFileGateway } from './infrastructure/private-file-gateway';
@Module({
  imports: [IdentityModule, SupabaseModule],
  controllers: [DocumentsController],
  providers: [
    {
      provide: DocumentUploadPolicy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new DocumentUploadPolicy(config.get('DOCUMENT_UPLOAD_MODE')),
    },
    DocumentsService,
    { provide: DocumentsRepository, useClass: KvgDocumentsRepository },
    { provide: PrivateFiles, useClass: PrivateFileGateway },
  ],
})
export class DocumentsModule {}
