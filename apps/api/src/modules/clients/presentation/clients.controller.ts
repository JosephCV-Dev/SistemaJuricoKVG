import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
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
import { RecordIdDto } from '../../../common/dto/record.dto';
import { ClientsService } from '../application/clients.service';
import {
  RegisterClientDto,
  SearchClientsDto,
  UpdateClientDto,
} from './clients.dto';

const clientScope = [
  'REGISTRO_PROPIO',
  'PRINCIPAL',
  'COLABORADOR',
  'EXPLICITO',
];

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
    validateContacts(input.contacts ?? []);
    return this.clients.register(userAccessToken(request), {
      ...input,
      contacts: input.contacts ?? [],
      identifications: input.identifications ?? [],
    });
  }

  @Patch(':id')
  @RequirePermission('cliente.actualizar', clientScope)
  @UseGuards(CsrfGuard)
  update(
    @Param() path: RecordIdDto,
    @Body() input: UpdateClientDto,
    @Req() request: Request,
  ) {
    if (
      input.name === undefined &&
      input.contacts === undefined &&
      input.identifications === undefined
    )
      throw new BadRequestException(
        'Indica al menos un campo para actualizar.',
      );
    validateContacts(input.contacts ?? []);
    return this.clients.update(userAccessToken(request), path.id, input);
  }

  @Get()
  @RequirePermission('cliente.consultar', clientScope)
  search(@Query() input: SearchClientsDto, @Req() request: Request) {
    return this.clients.search(userAccessToken(request), input);
  }

  @Get(':id/edit-identification-types')
  @RequirePermission('cliente.actualizar', clientScope)
  editIdentificationTypes(
    @Param() input: RecordIdDto,
    @Req() request: Request,
  ) {
    return this.clients.editIdentificationTypes(
      userAccessToken(request),
      input.id,
    );
  }

  @Get(':id')
  @RequirePermission('cliente.consultar', clientScope)
  get(@Param() input: RecordIdDto, @Req() request: Request) {
    return this.clients.get(userAccessToken(request), input.id);
  }
}

function validateContacts(
  contacts: NonNullable<RegisterClientDto['contacts']>,
) {
  for (const contact of contacts) {
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
        contacts.filter((item) => item.type === type && item.preferred).length >
        1,
    )
  )
    throw new BadRequestException(
      'Selecciona un solo contacto preferente por tipo.',
    );
}
