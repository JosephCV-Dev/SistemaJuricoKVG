import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RecordIdDto, SearchRecordsDto } from '../../../common/dto/record.dto';
import { StaffService } from '../application/staff.service';
import { Authenticated, RequirePermission } from './access.decorators';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { EmptyDto } from './auth.dto';
import { CsrfGuard } from './csrf.guard';
import {
  StaffAccessGrantDto,
  StaffCapabilityDto,
  StaffCaseSelectionDto,
  StaffEditDto,
  StaffInviteDto,
  StaffMatrixDto,
  StaffReasonDto,
  StaffRevisionDto,
  StaffRoleDto,
} from './staff.dto';
import { userAccessToken } from './user-access-token';

const caseScopes = ['PRINCIPAL', 'COLABORADOR', 'EXPLICITO'];

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('users')
  @Authenticated()
  list(@Query() query: SearchRecordsDto, @Req() req: Request) {
    return this.staff.repository.list(userAccessToken(req), query);
  }
  @Get('users/:id')
  @Authenticated()
  detail(@Param() p: RecordIdDto, @Req() req: Request) {
    return this.staff.repository.detail(userAccessToken(req), p.id);
  }
  @Post('users')
  @RequirePermission('usuario.administrar', 'GLOBAL_OPERATIVO')
  @UseGuards(CsrfGuard)
  reserve(@Body() input: StaffInviteDto, @Req() req: Request) {
    return this.staff.repository.reserve(userAccessToken(req), input);
  }
  @Post('users/:id/invite')
  @HttpCode(200)
  @RequirePermission('usuario.administrar', 'GLOBAL_OPERATIVO')
  @UseGuards(CsrfGuard, AuthRateLimitGuard)
  invite(
    @Param() p: RecordIdDto,
    @Body() _input: EmptyDto,
    @Req() req: Request,
  ) {
    return this.staff.sendInvitation(userAccessToken(req), p.id);
  }
  @Patch('users/:id')
  @RequirePermission('usuario.administrar', 'GLOBAL_OPERATIVO')
  @UseGuards(CsrfGuard)
  edit(
    @Param() p: RecordIdDto,
    @Body() input: StaffEditDto,
    @Req() req: Request,
  ) {
    return this.staff.repository.update(userAccessToken(req), p.id, input);
  }
  @Post('users/:id/deactivate')
  @HttpCode(200)
  @RequirePermission('usuario.administrar', 'GLOBAL_OPERATIVO')
  @UseGuards(CsrfGuard)
  deactivate(
    @Param() p: RecordIdDto,
    @Body() input: StaffRevisionDto,
    @Req() req: Request,
  ) {
    return this.staff.deactivate(userAccessToken(req), p.id, input);
  }
  @Post('users/:id/block-auth')
  @HttpCode(200)
  @RequirePermission('usuario.administrar', 'GLOBAL_OPERATIVO')
  @UseGuards(CsrfGuard)
  block(
    @Param() p: RecordIdDto,
    @Body() _input: EmptyDto,
    @Req() req: Request,
  ) {
    return this.staff.retryBlock(userAccessToken(req), p.id);
  }
  @Patch('users/:id/roles')
  @HttpCode(204)
  @RequirePermission('usuario.permisos', 'GLOBAL_OPERATIVO')
  @UseGuards(CsrfGuard)
  changeRole(
    @Param() p: RecordIdDto,
    @Body() input: StaffRoleDto,
    @Req() req: Request,
  ) {
    return this.staff.repository.changeRole(userAccessToken(req), p.id, input);
  }
  @Get('matrix')
  @RequirePermission('usuario.permisos', 'GLOBAL_OPERATIVO')
  matrix(@Query() query: StaffMatrixDto, @Req() req: Request) {
    return this.staff.repository.matrix(userAccessToken(req), query);
  }
  @Patch('matrix')
  @HttpCode(204)
  @RequirePermission('usuario.permisos', 'GLOBAL_OPERATIVO')
  @UseGuards(CsrfGuard)
  changeCapability(@Body() input: StaffCapabilityDto, @Req() req: Request) {
    return this.staff.repository.changeCapability(userAccessToken(req), input);
  }
  @Get('cases/:id/accesses')
  @RequirePermission('expediente.conceder', caseScopes)
  caseAccess(
    @Param() p: RecordIdDto,
    @Query() query: StaffCaseSelectionDto,
    @Req() req: Request,
  ) {
    return this.staff.repository.caseAccesses(
      userAccessToken(req),
      p.id,
      query.email,
    );
  }
  @Post('cases/:id/accesses')
  @HttpCode(204)
  @RequirePermission('expediente.conceder', caseScopes)
  @UseGuards(CsrfGuard)
  grant(
    @Param() p: RecordIdDto,
    @Body() input: StaffAccessGrantDto,
    @Req() req: Request,
  ) {
    return this.staff.repository.grant(userAccessToken(req), p.id, input);
  }
  @Post('accesses/:id/revoke')
  @HttpCode(204)
  @Authenticated()
  @UseGuards(CsrfGuard)
  revoke(
    @Param() p: RecordIdDto,
    @Body() input: StaffReasonDto,
    @Req() req: Request,
  ) {
    return this.staff.repository.revoke(
      userAccessToken(req),
      p.id,
      input.reason,
    );
  }
}
