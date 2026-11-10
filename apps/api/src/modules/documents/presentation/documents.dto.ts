import { Type } from 'class-transformer';
import {
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { CreationDto, Trim } from '../../../common/dto/record.dto';
export class CreateUploadDto extends CreationDto {
  @IsUUID('4') caseId!: string;
  @IsUUID('4') categoryId!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[^\x00-\x1f\x7f/\\]+\.(?:pdf|docx|jpe?g|png)$/i)
  originalName!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}
export class SearchDocumentsDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset = 0;
  @IsUUID('4') caseId!: string;
}
