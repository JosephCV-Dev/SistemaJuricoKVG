import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../../identity/presentation/access.decorators';
import { CsrfGuard } from '../../identity/presentation/csrf.guard';
import { userAccessToken } from '../../identity/presentation/user-access-token';
import { RecordIdDto, SearchRecordsDto } from '../../../common/dto/record.dto';
import { CasesService } from '../application/cases.service';
import {
  CreateCaseDto,
  SearchCasesDto,
  UpdateCaseDto,
  AssignCaseDto,
  ReassignCaseDto,
  SearchAssignedCasesDto,
} from './cases.dto';
const caseScope = ['PRINCIPAL', 'COLABORADOR', 'EXPLICITO'];

@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}
  @Post()
  @RequirePermission('expediente.crear', 'GLOBAL_OPERATIVO')
  @UseGuards(CsrfGuard)
  create(@Body() input: CreateCaseDto, @Req() request: Request) {
    if (Boolean(input.externalNumber) !== Boolean(input.externalAuthority))
      throw new BadRequestException(
        'Indica juntos el número externo y la autoridad que lo emitió, o deja ambos vacíos.',
      );
    return this.cases.create(userAccessToken(request), input);
  }
  @Patch(':id')
  @RequirePermission('expediente.actualizar', caseScope)
  @UseGuards(CsrfGuard)
  update(
    @Param() path: RecordIdDto,
    @Body() input: UpdateCaseDto,
    @Req() request: Request,
  ) {
    const { description, externalNumber, externalAuthority } = input;
    if (
      (externalNumber === undefined) !== (externalAuthority === undefined) ||
      (externalNumber === null) !== (externalAuthority === null)
    )
      throw new BadRequestException(
        'Indica juntos el número y la autoridad, o envía ambos como nulos para quitar la referencia.',
      );
    if (description === undefined && externalNumber === undefined)
      throw new BadRequestException(
        'Indica al menos un campo para actualizar.',
      );
    return this.cases.update(userAccessToken(request), path.id, input);
  }

  @Get()
  @RequirePermission('expediente.consultar', caseScope)
  search(@Query() input: SearchCasesDto, @Req() request: Request) {
    return this.cases.search(userAccessToken(request), input);
  }
  @Get('assigned')
  @RequirePermission('expediente.consultar', caseScope)
  assigned(@Query() input: SearchAssignedCasesDto, @Req() request: Request) {
    if (input.from && input.to && input.from > input.to)
      throw new BadRequestException(
        'La fecha inicial no puede ser posterior a la final.',
      );
    return this.cases.assigned(userAccessToken(request), input);
  }

  @Get('reassignable')
  @RequirePermission('expediente.reasignar', 'GLOBAL_OPERATIVO')
  reassignable(@Query() input: SearchRecordsDto, @Req() request: Request) {
    return this.cases.reassignable(userAccessToken(request), input);
  }

  @Get(':id/assignment-team')
  @RequirePermission('expediente.asignar', caseScope)
  assignTeam(
    @Param() path: RecordIdDto,
    @Query() input: SearchRecordsDto,
    @Req() request: Request,
  ) {
    return this.cases.team(userAccessToken(request), path.id, input, false);
  }

  @Get(':id/reassignment-team')
  @RequirePermission('expediente.reasignar', 'GLOBAL_OPERATIVO')
  reassignTeam(
    @Param() path: RecordIdDto,
    @Query() input: SearchRecordsDto,
    @Req() request: Request,
  ) {
    return this.cases.team(userAccessToken(request), path.id, input, true);
  }

  @Post(':id/assignments')
  @RequirePermission('expediente.asignar', caseScope)
  @UseGuards(CsrfGuard)
  assign(
    @Param() path: RecordIdDto,
    @Body() input: AssignCaseDto,
    @Req() request: Request,
  ) {
    return this.cases.assign(userAccessToken(request), path.id, input);
  }

  @Post(':id/reassignments')
  @HttpCode(200)
  @RequirePermission('expediente.reasignar', 'GLOBAL_OPERATIVO')
  @UseGuards(CsrfGuard)
  reassign(
    @Param() path: RecordIdDto,
    @Body() input: ReassignCaseDto,
    @Req() request: Request,
  ) {
    return this.cases.reassign(userAccessToken(request), path.id, input);
  }

  @Get(':id')
  @RequirePermission('expediente.consultar', caseScope)
  get(@Param() input: RecordIdDto, @Req() request: Request) {
    return this.cases.get(userAccessToken(request), input.id);
  }
}
