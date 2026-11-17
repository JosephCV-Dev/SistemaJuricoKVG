import {
  IsIn,
  IsBoolean,
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  CreationDto,
  IfProvided,
  SearchRecordsDto,
  Trim,
} from '../../../common/dto/record.dto';
import type { CaseUpdateReason } from '@kvg/contracts';
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
export class UpdateCaseDto {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  revision!: number;

  @IsIn([
    'CORREGIR_CAPTURA',
    'PRECISAR_DESCRIPCION',
    'ACTUALIZAR_REFERENCIA',
    'OTRA_CORRECCION',
  ])
  reason!: CaseUpdateReason;

  @IfProvided()
  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  description?: string;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  externalNumber?: string | null;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(512)
  externalAuthority?: string | null;
}

export class SearchCasesDto extends SearchRecordsDto {
  @IfProvided()
  @IsIn(['NUEVO', 'EN_PROCESO', 'PENDIENTE', 'CONCLUIDO', 'ARCHIVADO'])
  status?: CaseState;

  @IfProvided()
  @Trim()
  @IsString()
  @MaxLength(200)
  client?: string;

  @IfProvided()
  @Trim()
  @IsString()
  @MaxLength(200)
  responsible?: string;
}

class AssignmentFieldsDto {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  revision!: number;

  @IsUUID('4')
  lawyerId!: string;

  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  reason!: string;
}

export class AssignCaseDto extends AssignmentFieldsDto {
  @IsIn(['PRINCIPAL', 'COLABORADOR'])
  role!: 'PRINCIPAL' | 'COLABORADOR';
}
export class ReassignCaseDto extends AssignmentFieldsDto {
  @Trim()
  @IsString()
  @Matches(/^[A-Za-z0-9._:/-]{1,128}$/)
  approvalReference!: string;

  @IsBoolean()
  keepCollaborator!: boolean;
}

export class SearchAssignedCasesDto extends SearchRecordsDto {
  @IfProvided()
  @IsIn(['NUEVO', 'EN_PROCESO', 'PENDIENTE', 'CONCLUIDO', 'ARCHIVADO'])
  status?: CaseState;

  @IfProvided()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from?: string;

  @IfProvided()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to?: string;

  @IfProvided()
  @IsIn(['PRINCIPAL', 'COLABORADOR', 'EXPLICITO'])
  participation?: 'PRINCIPAL' | 'COLABORADOR' | 'EXPLICITO';
}
