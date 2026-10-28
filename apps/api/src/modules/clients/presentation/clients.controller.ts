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
import { isEmail } from 'class-validator';
import type { Request } from 'express';
import { RequirePermission } from '../../identity/presentation/access.decorators';
import { CsrfGuard } from '../../identity/presentation/csrf.guard';
import { userAccessToken } from '../../identity/presentation/user-access-token';
import { RecordIdDto, SearchRecordsDto } from '../../../common/dto/record.dto';
import { ClientsService } from '../application/clients.service';
import { RegisterClientDto } from './clients.dto';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get('identification-types')
  @RequirePermission('cliente.registrar', 'GLOBAL_OPERATIVO')
  identificationTypes(@Req() request: Request) {
    return this.clients.identificationTypes(userAccessToken(request));
  }

  @Post()
  @RequirePermission('cliente.registrar', 'GLOBAL_OPERATIVO')
  @UseGuards(CsrfGuard)
  register(@Body() input: RegisterClientDto, @Req() request: Request) {
    for (const contact of input.contacts) {
      if (
        (contact.type === 'CORREO' && !isEmail(contact.value)) ||
        (contact.type === 'TELEFONO' &&
          !/^[+0-9][0-9 ()-]{5,31}$/.test(contact.value))
      )
        throw new BadRequestException(
          'El correo o teléfono no tiene un formato válido.',
        );
    }
    if (
      ['CORREO', 'TELEFONO'].some(
        (type) =>
          input.contacts.filter((item) => item.type === type && item.preferred)
            .length > 1,
      )
    )
      throw new BadRequestException(
        'Selecciona un solo contacto preferente por tipo.',
      );
    return this.clients.register(userAccessToken(request), input);
  }

  @Get()
  @RequirePermission('cliente.consultar', [
    'REGISTRO_PROPIO',
    'PRINCIPAL',
    'COLABORADOR',
    'EXPLICITO',
  ])
  search(@Query() input: SearchRecordsDto, @Req() request: Request) {
    return this.clients.search(userAccessToken(request), input);
  }

  @Get(':id')
  @RequirePermission('cliente.consultar', [
    'REGISTRO_PROPIO',
    'PRINCIPAL',
    'COLABORADOR',
    'EXPLICITO',
  ])
  get(@Param() input: RecordIdDto, @Req() request: Request) {
    return this.clients.get(userAccessToken(request), input.id);
  }
}
