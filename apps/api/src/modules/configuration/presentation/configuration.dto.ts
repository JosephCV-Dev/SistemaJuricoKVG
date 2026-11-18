import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { IdentificationRule, SessionParameterCode } from '@kvg/contracts';
import { Trim } from '../../../common/dto/record.dto';

const catalogCode = /^[A-Z][A-Z0-9_]{0,63}$/;

class ConfirmedChange {
  @Equals(true)
  confirmed!: true;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}

export class ParameterCodeDto {
  @IsIn(['sesion.inactividad_minutos', 'sesion.duracion_horas'])
  code!: SessionParameterCode;
}

export class CatalogCodeDto {
  @Matches(catalogCode)
  code!: string;
}

export class ParameterChangeDto extends ConfirmedChange {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  revision!: number;

  @IsInt()
  @Min(1)
  @Max(30)
  value!: number;
}

class CatalogChange extends ConfirmedChange {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}

class CategoryFields extends CatalogChange {
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class NewCategoryDto extends CategoryFields {
  @Matches(catalogCode)
  code!: string;
}

export class UpdateCategoryDto extends CategoryFields {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  revision!: number;

  @IsBoolean()
  active!: boolean;
}

export class NewIdentificationDto extends CatalogChange {
  @Matches(catalogCode)
  code!: string;

  @IsIn(['EXACTA_V1', 'MAYUSCULAS_V1', 'ALFANUMERICA_V1'])
  rule!: IdentificationRule;

  @IsBoolean()
  unique!: boolean;
}

export class UpdateIdentificationDto extends CatalogChange {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  revision!: number;

  @IsBoolean()
  active!: boolean;
}
