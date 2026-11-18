import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffAuth } from '../application/staff.ports';
import { createClient } from '@supabase/supabase-js';
import type { Environment } from '../../../config/environment';

@Injectable()
export class SupabaseStaffAuth extends StaffAuth {
  constructor(private readonly config: ConfigService<Environment>) {
    super();
  }

  private client(technical: boolean) {
    const url = this.config.get('SUPABASE_URL', { infer: true });
    const key = this.config.get(
      technical ? 'SUPABASE_SECRET_KEY' : 'SUPABASE_PUBLISHABLE_KEY',
      { infer: true },
    );
    if (!url || !key)
      throw new ServiceUnavailableException(
        'Supabase Auth no está configurado.',
      );
    return createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: { retry: false },
      global: {
        fetch: (input, options) =>
          fetch(input, {
            ...options,
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
          }),
      },
    });
  }

  async invite(email: string) {
    const origin = this.config.get('APP_ORIGIN', { infer: true });
    const { data, error } = await this.client(
      true,
    ).auth.admin.inviteUserByEmail(email, {
      redirectTo: new URL('/activar-cuenta', origin).href,
    });
    if (error?.code === 'email_address_not_authorized')
      throw new BadRequestException(
        'El correo no está autorizado por el servicio de correo de Supabase.',
      );
    if (error?.code === 'email_exists' || error?.code === 'user_already_exists')
      throw new ConflictException(
        'El proveedor ya tiene una cuenta para ese correo.',
      );
    if (error?.status === 429)
      throw new HttpException(
        'El servicio de correo limitó los envíos. Intenta más tarde.',
        429,
      );
    if (error || !data.user?.id)
      throw new ServiceUnavailableException(
        'El proveedor no pudo aceptar el envío.',
      );
  }

  async verifyInvite(hash: string) {
    const { data, error } = await this.client(false).auth.verifyOtp({
      token_hash: hash,
      type: 'invite',
    });
    if (error && (error.status === undefined || error.status >= 500))
      throw new ServiceUnavailableException(
        'El servicio de invitaciones no está disponible.',
      );
    if (error || !data.session?.access_token)
      throw new UnauthorizedException(
        'El enlace de invitación es inválido o venció.',
      );
    return data.session.access_token;
  }

  async setInvitedPassword(accessToken: string, password: string) {
    const url = this.config.get('SUPABASE_URL', { infer: true });
    const key = this.config.get('SUPABASE_PUBLISHABLE_KEY', { infer: true });
    if (!url || !key)
      throw new ServiceUnavailableException(
        'Supabase Auth no está configurado.',
      );
    const result = await fetch(new URL('/auth/v1/user', url), {
      method: 'PUT',
      headers: {
        apikey: key,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    }).catch(() => {
      throw new ServiceUnavailableException(
        'No se pudo guardar la contraseña.',
      );
    });
    if (result.ok) return;
    if ([401, 403].includes(result.status))
      throw new UnauthorizedException('La invitación ya no está disponible.');
    if (result.status < 500)
      throw new BadRequestException(
        'La contraseña no cumple la política de acceso.',
      );
    throw new ServiceUnavailableException('No se pudo guardar la contraseña.');
  }

  async block(authId: string) {
    // Supabase expresa el bloqueo como una duración no nula.
    const { error } = await this.client(true).auth.admin.updateUserById(
      authId,
      { ban_duration: '876000h' },
    );
    return !error;
  }
}
