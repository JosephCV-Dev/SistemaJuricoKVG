import { BadGatewayException, Injectable } from '@nestjs/common';
import { KvgRpcService } from '../../../infrastructure/supabase/kvg-rpc.service';
import { OperationalSession } from '../application/identity.ports';
import type { IdentityContext } from '../domain/identity.types';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class KvgOperationalSession extends OperationalSession {
  constructor(private readonly rpc: KvgRpcService) {
    super();
  }

  async start(accessToken: string): Promise<void> {
    await this.rpc.execute(accessToken, 'sesion.iniciar', {});
  }

  async close(accessToken: string): Promise<void> {
    await this.rpc.execute(accessToken, 'sesion.cerrar', {});
  }

  async current(accessToken: string): Promise<IdentityContext> {
    const data = await this.rpc.execute(accessToken, 'sesion.consultar', {});
    if (
      !record(data) ||
      !record(data.usuario) ||
      !record(data.sesion) ||
      typeof data.usuario.usuario_id !== 'string' ||
      typeof data.usuario.nombre !== 'string' ||
      !Array.isArray(data.roles) ||
      !data.roles.every((role) => typeof role === 'string') ||
      !Array.isArray(data.capacidades) ||
      typeof data.sesion.expira_en !== 'string' ||
      !Number.isFinite(Date.parse(data.sesion.expira_en)) ||
      typeof data.sesion.inactividad_minutos !== 'number' ||
      data.sesion.inactividad_minutos < 1
    ) {
      throw new BadGatewayException(
        'El contexto de sesión no cumple el contrato.',
      );
    }
    const capabilities: IdentityContext['capabilities'] = data.capacidades.map(
      (capability: unknown) => {
        if (
          !record(capability) ||
          typeof capability.permiso !== 'string' ||
          typeof capability.contexto !== 'string' ||
          typeof capability.requiere_mfa !== 'boolean' ||
          typeof capability.requiere_decision !== 'boolean'
        ) {
          throw new BadGatewayException(
            'El contexto de sesión no cumple el contrato.',
          );
        }
        return {
          permission: capability.permiso,
          context: capability.contexto,
          requiresMfa: capability.requiere_mfa,
          requiresDecision: capability.requiere_decision,
        };
      },
    );
    return {
      user: {
        id: data.usuario.usuario_id,
        name: data.usuario.nombre,
        roles: data.roles as string[],
      },
      capabilities,
      expiresAt: data.sesion.expira_en,
      idleTimeoutSeconds: data.sesion.inactividad_minutos * 60,
    };
  }
}
