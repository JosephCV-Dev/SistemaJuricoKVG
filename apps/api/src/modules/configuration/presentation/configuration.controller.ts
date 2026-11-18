import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RecordIdDto } from '../../../common/dto/record.dto';
import { RequirePermission } from '../../identity/presentation/access.decorators';
import { CsrfGuard } from '../../identity/presentation/csrf.guard';
import { userAccessToken } from '../../identity/presentation/user-access-token';
import { KvgConfigurationRepository } from '../infrastructure/kvg-configuration.repository';
import {
  CatalogCodeDto,
  NewCategoryDto,
  NewIdentificationDto,
  ParameterChangeDto,
  ParameterCodeDto,
  UpdateCategoryDto,
  UpdateIdentificationDto,
} from './configuration.dto';

@Controller('configuration')
@RequirePermission('configuracion.administrar', 'GLOBAL_OPERATIVO')
export class ConfigurationController {
  constructor(private readonly configuration: KvgConfigurationRepository) {}

  @Get()
  snapshot(@Req() req: Request) {
    return this.configuration.snapshot(userAccessToken(req));
  }

  @Patch('parameters/:code')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async changeParameter(
    @Param() { code }: ParameterCodeDto,
    @Body() input: ParameterChangeDto,
    @Req() req: Request,
  ) {
    const { value, revision, reason } = input;
    if (code === 'sesion.inactividad_minutos' ? value < 5 : value > 8)
      throw new BadRequestException(
        'El valor está fuera del intervalo permitido.',
      );
    await this.configuration.changeParameter(
      userAccessToken(req),
      code,
      value,
      revision,
      reason,
    );
  }

  @Post('categories')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async createCategory(@Body() input: NewCategoryDto, @Req() req: Request) {
    await this.configuration.saveCategory(userAccessToken(req), input);
  }

  @Patch('categories/:id')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async updateCategory(
    @Param() { id }: RecordIdDto,
    @Body() input: UpdateCategoryDto,
    @Req() req: Request,
  ) {
    await this.configuration.saveCategory(userAccessToken(req), {
      id,
      ...input,
    });
  }

  @Post('identification-types')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async createIdentification(
    @Body() input: NewIdentificationDto,
    @Req() req: Request,
  ) {
    await this.configuration.saveIdentification(userAccessToken(req), input);
  }

  @Patch('identification-types/:code')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async updateIdentification(
    @Param() { code }: CatalogCodeDto,
    @Body() input: UpdateIdentificationDto,
    @Req() req: Request,
  ) {
    await this.configuration.saveIdentification(userAccessToken(req), {
      code,
      ...input,
    });
  }
}
