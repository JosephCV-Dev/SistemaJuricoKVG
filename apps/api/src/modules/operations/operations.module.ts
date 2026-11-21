import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { RenderDocumentWorker } from './infrastructure/render-document-worker';

@Module({
  imports: [DocumentsModule],
  providers: [RenderDocumentWorker],
})
export class OperationsModule {}
