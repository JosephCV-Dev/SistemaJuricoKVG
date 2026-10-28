import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreationDto, IfProvided, Trim } from '../../../common/dto/record.dto';

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

// El formato depende del tipo; se comprueba en el servicio de entrada antes del RPC.
export class RegisterClientDto extends CreationDto {
  @Trim()
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  name!: string;
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => IdentificationDto)
  identifications: IdentificationDto[] = [];
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts: ContactDto[] = [];
}
