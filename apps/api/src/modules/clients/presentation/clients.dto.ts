import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsUUID,
  Min,
  Max,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  IfProvided,
  SearchRecordsDto,
  Trim,
} from '../../../common/dto/record.dto';

export class IdentificationDto {
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)
  type!: string;
  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  value!: string;
}
export class ContactDto {
  @IsIn(['CORREO', 'TELEFONO'])
  type!: 'CORREO' | 'TELEFONO';
  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(254)
  value!: string;
  @IfProvided()
  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(80)
  label?: string;
  @IsBoolean()
  preferred = false;
}

class ClientMediaDto {
  @IfProvided()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => IdentificationDto)
  identifications?: IdentificationDto[];

  @IfProvided()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts?: ContactDto[];
}

export class RegisterClientDto extends ClientMediaDto {
  @IsUUID('4')
  requestId!: string;

  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  name!: string;
}

export class UpdateClientDto extends ClientMediaDto {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  revision!: number;

  @IfProvided()
  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  name?: string;
}

export class SearchClientsDto extends SearchRecordsDto {
  @IfProvided()
  @Trim()
  @IsString()
  @MaxLength(100)
  identification?: string;
}
