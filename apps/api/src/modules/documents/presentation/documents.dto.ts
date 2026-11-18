import {
  IsString,
  IsDateString,
  IsIn,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import type { DocumentReviewOutcome, DocumentState } from '@kvg/contracts';
import {
  CreationDto,
  RecordIdDto,
  Trim,
  SearchRecordsDto,
  IfProvided,
} from '../../../common/dto/record.dto';
import {
  DOCUMENT_REVIEW_OUTCOMES,
  DOCUMENT_STATES,
} from '../domain/document.types';
class DocumentFileDto extends CreationDto {
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[^\x00-\x1f\x7f/\\]+\.(?:pdf|docx|jpe?g|png)$/i)
  originalName!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}
export class CreateUploadDto extends DocumentFileDto {
  @IsUUID('4') caseId!: string;
  @IsUUID('4') categoryId!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(200) name!: string;
}
export class CreateVersionUploadDto extends DocumentFileDto {
  @IsInt() @Min(1) @Max(2147483647) revision!: number;
}
export class SearchDocumentsDto extends SearchRecordsDto {
  @IfProvided() @IsUUID('4') caseId?: string;
  @IfProvided() @IsUUID('4') categoryId?: string;
  @IfProvided() @Trim() @IsString() @MaxLength(40) folio?: string;
  @IfProvided() @Trim() @IsString() @MaxLength(200) client?: string;
  @IfProvided()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from?: string;
  @IfProvided()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to?: string;
  @IfProvided()
  @IsIn(DOCUMENT_STATES)
  status?: DocumentState;
  @IfProvided()
  @IsIn(['recientes', 'antiguos', 'nombre'])
  order?: 'recientes' | 'antiguos' | 'nombre';
}
class DocumentRevisionDto {
  @IsInt() @Min(1) @Max(2147483647) revision!: number;
}
export class DocumentVersionIdDto extends RecordIdDto {
  @IsUUID('4') versionId!: string;
}
export class DocumentReviewDto extends CreationDto {
  @IsIn(DOCUMENT_REVIEW_OUTCOMES) result!: DocumentReviewOutcome;
  @Trim() @IsString() @MinLength(1) @MaxLength(4000) observations!: string;
  @IfProvided() @IsUUID('4') correctsId?: string;
}
export class DocumentStateDto extends DocumentRevisionDto {
  @IsIn(DOCUMENT_STATES) status!: DocumentState;
  @Trim() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
  @IfProvided() @IsUUID('4') reviewId?: string;
}
export class RetireDocumentDto extends DocumentRevisionDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}
export class RecoverDocumentDto extends RetireDocumentDto {
  @IsUUID('4') requestId!: string;
}
export class UpdateDocumentMetadataDto extends DocumentRevisionDto {
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/^[^\x00-\x1f\x7f]+$/)
  name!: string;

  @Trim() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}
export class ClassifyDocumentDto extends DocumentRevisionDto {
  @IsUUID('4') categoryId!: string;
  @IfProvided()
  @IsIn(['CORREGIR_CLASIFICACION', 'ORGANIZACION_CATALOGO', 'OTRA_CORRECCION'])
  reason?:
    'CORREGIR_CLASIFICACION' | 'ORGANIZACION_CATALOGO' | 'OTRA_CORRECCION';
}
export class AssociateDocumentDto extends DocumentRevisionDto {
  @IsUUID('4') destinationId!: string;
  @Trim() @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
