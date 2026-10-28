import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  AuthState,
  CsrfResponse,
  MfaEnrollmentResponse,
  AuthUser,
} from '@kvg/contracts';
import { randomUUID } from 'node:crypto';
import { IdentityService } from '../application/identity.service';
import { Authenticated, Public } from './access.decorators';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { CsrfGuard } from './csrf.guard';
import { EmptyDto, LoginDto, MfaVerifyDto } from './auth.dto';
import { ServerSessions } from './server-sessions.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('IdentitySecurity');
  constructor(
    private readonly identity: IdentityService,
    private readonly sessions: ServerSessions,
  ) {}

  private event(action: string, result: 'EXITO' | 'DENEGADO'): void {
    this.logger.log(
      JSON.stringify({ action, result, correlationId: randomUUID() }),
    );
  }

  @Get('csrf')
  @Public()
  async csrf(@Req() request: Request): Promise<CsrfResponse> {
    return { csrfToken: await this.sessions.csrf(request) };
  }

  @Post('login')
  @HttpCode(200)
  @Public()
  @UseGuards(CsrfGuard, AuthRateLimitGuard)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
  ): Promise<AuthState> {
    return this.sessions.exclusive(request, async () => {
      try {
        if (request.session.authentication)
          await this.identity.logout(request.session.authentication);
        const authentication = await this.identity.login(
          input.email,
          input.password,
        );
        await this.sessions.rotate(request, authentication);
        const result = await this.identity.state(authentication, (renewed) =>
          this.sessions.persistAuthentication(request, renewed),
        );
        this.sessions.assign(request, result.authentication);
        await this.sessions.save(request);
        this.event('AUTH_PRIMER_FACTOR', 'EXITO');
        return result.state;
      } catch (error) {
        this.event('AUTH_PRIMER_FACTOR', 'DENEGADO');
        throw error;
      }
    });
  }

  @Get('session')
  @Public()
  async state(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthState> {
    this.sessions.require(request);
    if (!request.session.authentication) return { status: 'anonymous' };
    try {
      return await this.sessions.exclusive(request, async () => {
        const authentication = request.session.authentication;
        if (!authentication) return { status: 'anonymous' };
        const result = await this.identity.state(authentication, (renewed) =>
          this.sessions.persistAuthentication(request, renewed),
        );
        this.sessions.assign(request, result.authentication);
        await this.sessions.save(request);
        return result.state;
      });
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        await this.sessions.destroy(request, response).catch(() => undefined);
        return { status: 'anonymous' };
      }
      throw error;
    }
  }

  @Get('me')
  @Authenticated()
  me(@Req() request: Request): AuthUser {
    if (!request.identity)
      throw new UnauthorizedException('Se requiere una sesión autenticada.');
    return request.identity.user;
  }

  @Post('mfa/enroll')
  @HttpCode(200)
  @Public()
  @UseGuards(CsrfGuard, AuthRateLimitGuard)
  async enroll(
    @Body() _input: EmptyDto,
    @Req() request: Request,
  ): Promise<MfaEnrollmentResponse> {
    return this.sessions.exclusive(request, async () => {
      const authentication = request.session.authentication;
      if (!authentication)
        throw new UnauthorizedException('Se requiere iniciar sesión.');
      const result = await this.identity.enroll(authentication, (renewed) =>
        this.sessions.persistAuthentication(request, renewed),
      );
      this.sessions.assign(request, result.authentication);
      await this.sessions.save(request);
      return result.enrollment;
    });
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @Public()
  @UseGuards(CsrfGuard, AuthRateLimitGuard)
  async verify(
    @Body() input: MfaVerifyDto,
    @Req() request: Request,
  ): Promise<AuthState> {
    return this.sessions.exclusive(request, async () => {
      try {
        const authentication = request.session.authentication;
        if (!authentication)
          throw new UnauthorizedException('Se requiere iniciar sesión.');
        const result = await this.identity.verify(
          authentication,
          input.factorId,
          input.code,
          (renewed) => this.sessions.persistAuthentication(request, renewed),
        );
        try {
          await this.sessions.rotate(request, result.authentication);
        } catch (error) {
          await this.identity
            .logout(result.authentication)
            .catch(() => undefined);
          throw error;
        }
        this.event('AUTH_MFA', 'EXITO');
        return result.state;
      } catch (error) {
        this.event('AUTH_MFA', 'DENEGADO');
        throw error;
      }
    });
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  @UseGuards(CsrfGuard, AuthRateLimitGuard)
  async refresh(
    @Body() _input: EmptyDto,
    @Req() request: Request,
  ): Promise<AuthState> {
    return this.sessions.exclusive(request, async () => {
      const authentication = request.session.authentication;
      if (!authentication)
        throw new UnauthorizedException('Se requiere iniciar sesión.');
      const persistRefreshed = (renewed: typeof authentication) =>
        this.sessions.persistAuthentication(request, renewed);
      const refreshed = await this.identity.prepare(
        authentication,
        true,
        persistRefreshed,
      );
      const result = await this.identity.state(refreshed, persistRefreshed);
      this.sessions.assign(request, result.authentication);
      await this.sessions.save(request);
      return result.state;
    });
  }

  @Post('logout')
  @HttpCode(204)
  @Public()
  @UseGuards(CsrfGuard)
  async logout(
    @Body() _input: EmptyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.exclusive(request, async () => {
      try {
        if (request.session.authentication)
          await this.identity.logout(request.session.authentication);
        this.event('AUTH_CERRAR', 'EXITO');
      } finally {
        await this.sessions.destroy(request, response);
      }
    });
  }
}
