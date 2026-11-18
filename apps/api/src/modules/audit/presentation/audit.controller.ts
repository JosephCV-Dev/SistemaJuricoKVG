import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { RecordIdDto } from '../../../common/dto/record.dto';
import { RequirePermission } from '../../identity/presentation/access.decorators';
import { userAccessToken } from '../../identity/presentation/user-access-token';
import { KvgAuditRepository } from '../infrastructure/kvg-audit.repository';
import { AuditQueryDto } from './audit-query.dto';

@Controller('audit')
@RequirePermission('auditoria.consultar', 'GLOBAL_OPERATIVO')
export class AuditController {
  constructor(private readonly audit: KvgAuditRepository) {}

  @Get()
  list(@Query() query: AuditQueryDto, @Req() req: Request) {
    if (
      (query.from && query.to && query.from > query.to) ||
      Boolean(query.beforeAt) !== Boolean(query.beforeId)
    )
      throw new BadRequestException(
        'Revisa el rango de fechas o el cursor de la consulta.',
      );
    const { from, to, ...filters } = query;
    const until = to
      ? new Date(Date.parse(to + 'T00:00:00Z') + 86_400_000).toISOString()
      : undefined;
    return this.audit.list(userAccessToken(req), {
      ...filters,
      ...(from ? { from: from + 'T00:00:00Z' } : {}),
      ...(until ? { until } : {}),
    });
  }

  @Get(':id')
  detail(@Param() params: RecordIdDto, @Req() req: Request) {
    return this.audit.detail(userAccessToken(req), params.id);
  }
}
