import {
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IfProvided, Trim } from '../../../common/dto/record.dto';
import type { AuditResult } from '@kvg/contracts';

export class AuditQueryDto {
  @IfProvided()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from?: string;
  @IfProvided()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to?: string;
  @IfProvided() @Trim() @IsString() @MaxLength(200) actor?: string;
  @IfProvided() @Trim() @IsString() @MaxLength(64) action?: string;
  @IfProvided() @Trim() @IsString() @MaxLength(64) resource?: string;
  @IfProvided()
  @IsIn(['EXITO', 'DENEGADO', 'FALLIDO', 'RECIBIDO'])
  result?: AuditResult;
  @IfProvided()
  @IsDateString({ strict: true, strictSeparator: true })
  @MaxLength(40)
  beforeAt?: string;
  @IfProvided() @IsUUID('4') beforeId?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}
