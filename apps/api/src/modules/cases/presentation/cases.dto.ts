import { IsIn, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import {
  CreationDto,
  IfProvided,
  SearchRecordsDto,
  Trim,
} from '../../../common/dto/record.dto';
import type { CaseState } from '../domain/case.types';
export class CreateCaseDto extends CreationDto {
  @IsUUID('4') clientId!: string;
  @Trim() @IsString() @Matches(/\S/) @MaxLength(2000) description!: string;
  @IfProvided()
  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  externalNumber?: string;
  @IfProvided()
  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(512)
  externalAuthority?: string;
}
export class SearchCasesDto extends SearchRecordsDto {
  @IfProvided()
  @IsIn(['NUEVO', 'EN_PROCESO', 'PENDIENTE', 'CONCLUIDO', 'ARCHIVADO'])
  status?: CaseState;
}
