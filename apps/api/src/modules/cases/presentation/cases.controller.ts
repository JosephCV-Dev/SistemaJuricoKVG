import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../../identity/presentation/access.decorators';
import { CsrfGuard } from '../../identity/presentation/csrf.guard';
import { userAccessToken } from '../../identity/presentation/user-access-token';
import { RecordIdDto } from '../../../common/dto/record.dto';
import { CasesService } from '../application/cases.service';
import { CreateCaseDto, SearchCasesDto } from './cases.dto';
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
  @Get()
  @RequirePermission('expediente.consultar', [
    'PRINCIPAL',
    'COLABORADOR',
    'EXPLICITO',
  ])
  search(@Query() input: SearchCasesDto, @Req() request: Request) {
    return this.cases.search(userAccessToken(request), input);
  }
  @Get(':id')
  @RequirePermission('expediente.consultar', [
    'PRINCIPAL',
    'COLABORADOR',
    'EXPLICITO',
  ])
  get(@Param() input: RecordIdDto, @Req() request: Request) {
    return this.cases.get(userAccessToken(request), input.id);
  }
}
