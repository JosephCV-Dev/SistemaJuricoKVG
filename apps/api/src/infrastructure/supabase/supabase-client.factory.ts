import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Environment } from '../../config/environment';

@Injectable()
export class SupabaseClientFactory {
  constructor(private readonly config: ConfigService<Environment>) {}

  // El token deberá proceder de la sesión validada en el servidor (CU023/CU024).
  // Esta fábrica no autentica usuarios ni sustituye la comprobación de identidad.
  forUser(accessToken: string): SupabaseClient {
    if (!accessToken || /\s/.test(accessToken)) {
      throw new UnauthorizedException('Se requiere una sesión autenticada.');
    }
    const url = this.config.get('SUPABASE_URL', { infer: true });
    const key = this.config.get('SUPABASE_PUBLISHABLE_KEY', { infer: true });
    if (!url || !key) {
      throw new ServiceUnavailableException('Supabase no está configurado.');
    }

    return createClient(url, key, {
      db: { schema: 'public', retry: false },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }
}
