import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

// A diferencia de IsOptional, un null explícito no omite la validación.
export const IfProvided = () =>
  ValidateIf((_object, value: unknown) => value !== undefined);

export class RecordIdDto {
  @IsUUID('4')
  id!: string;
}

export class RecordPaginationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  offset = 0;
}

export class SearchRecordsDto extends RecordPaginationDto {
  @IfProvided()
  @Trim()
  @IsString()
  @MaxLength(200)
  text?: string;
}

export class CreationDto {
  @IsUUID('4')
  requestId!: string;
}
