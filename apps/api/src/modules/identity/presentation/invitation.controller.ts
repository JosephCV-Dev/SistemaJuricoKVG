import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { StaffAuth, StaffRepository } from '../application/staff.ports';
import { Public } from './access.decorators';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { CsrfGuard } from './csrf.guard';
import { ServerSessions } from './server-sessions.service';
import { FinishInvitationDto } from './staff.dto';

@Controller('auth/invitation')
export class InvitationController {
  constructor(
    private readonly auth: StaffAuth,
    private readonly repository: StaffRepository,
    private readonly sessions: ServerSessions,
  ) {}

  @Post('complete')
  @HttpCode(204)
  @Public()
  @UseGuards(CsrfGuard, AuthRateLimitGuard)
  complete(@Body() input: FinishInvitationDto, @Req() req: Request) {
    if (Buffer.byteLength(input.password, 'utf8') > 72)
      throw new BadRequestException(
        'La contraseña excede el máximo de 72 bytes.',
      );
    return this.sessions.exclusive(req, async () => {
      const digest = input.tokenHash
        ? createHash('sha256').update(input.tokenHash).digest('hex')
        : undefined;
      let pending = req.session.invitation;
      if (
        !pending ||
        pending.expiresAt <= Date.now() ||
        (digest && digest !== pending.digest)
      ) {
        if (!input.tokenHash || !digest)
          throw new UnauthorizedException(
            'Abre un enlace de invitación vigente.',
          );
        const accessToken = await this.auth.verifyInvite(input.tokenHash);
        await this.repository.checkInvitation(accessToken);
        pending = { accessToken, digest, expiresAt: Date.now() + 10 * 60_000 };
        req.session.invitation = pending;
        await this.sessions.save(req);
      } else {
        await this.repository.checkInvitation(pending.accessToken);
      }
      await this.auth.setInvitedPassword(pending.accessToken, input.password);
      delete req.session.invitation;
      await this.sessions.save(req);
    });
  }
}
