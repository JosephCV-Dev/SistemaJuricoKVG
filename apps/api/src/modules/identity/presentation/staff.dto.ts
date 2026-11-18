import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { PermissionContext, StaffRole } from '@kvg/contracts';
import {
  CreationDto,
  IfProvided,
  RecordPaginationDto,
  Trim,
} from '../../../common/dto/record.dto';
import { staffContexts, staffRoles } from '../domain/staff.types';

const Email = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
export class StaffReasonDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}
export class StaffRevisionDto extends StaffReasonDto {
  @IsInt() @Min(1) @Max(2147483647) revision!: number;
}
export class StaffInviteDto extends CreationDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @Email() @IsEmail() @MaxLength(254) email!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}
export class StaffEditDto extends StaffRevisionDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(200) name!: string;
}
class StaffApprovedChangeDto extends StaffRevisionDto {
  @IsIn(staffRoles) role!: StaffRole;
  @Trim() @IsString() @MinLength(1) @MaxLength(512) approval!: string;
}
export class StaffRoleDto extends StaffApprovedChangeDto {
  @IsIn(['grant', 'revoke']) action!: 'grant' | 'revoke';
}
export class StaffMatrixDto extends RecordPaginationDto {
  @IsIn(staffRoles) role!: StaffRole;
}
export class StaffCapabilityDto extends StaffApprovedChangeDto {
  @Matches(/^[a-z][a-z0-9_.]{0,63}$/) permission!: string;
  @IsIn(staffContexts) context!: PermissionContext;
  @IsBoolean() active!: boolean;
}
export class StaffCaseSelectionDto {
  @IfProvided() @Email() @IsEmail() @MaxLength(254) email?: string;
}
export class StaffAccessGrantDto extends StaffReasonDto {
  @IsUUID('4') userId!: string;
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @Matches(/^[a-z][a-z0-9_.]{0,63}$/, { each: true })
  permissions!: string[];
  @Trim() @IsString() @MinLength(1) @MaxLength(512) approval!: string;
  @IfProvided() @IsDateString({ strict: true }) expiresAt?: string;
}
export class FinishInvitationDto {
  @IfProvided() @Matches(/^[A-Za-z0-9_-]{20,256}$/) tokenHash?: string;
  @IsString() @MinLength(12) @MaxLength(72) password!: string;
}
