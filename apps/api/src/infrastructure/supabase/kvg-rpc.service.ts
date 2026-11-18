import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseClientFactory } from './supabase-client.factory';

@Injectable()
export class KvgRpcService {
  constructor(private readonly clients: SupabaseClientFactory) {}

  // Uso interno por casos de uso concretos. No exponer como endpoint RPC genérico.
  async execute(
    accessToken: string,
    operation: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const client = this.clients.forUser(accessToken);
    let result;
    try {
      result = await client
        .rpc('kvg_operar', { p_operacion: operation, p_datos: input })
        .abortSignal(AbortSignal.timeout(10_000));
    } catch {
      throw new ServiceUnavailableException(
        'No fue posible contactar con el servicio de datos.',
      );
    }

    if (result.error) {
      if (result.status === 401)
        throw new UnauthorizedException('La sesión no es válida.');
      throwRpcError(result.error.code);
    }

    const payload: unknown = result.data;
    if (!isRecord(payload) || typeof payload.correcto !== 'boolean') {
      throw new BadGatewayException(
        'La respuesta del servicio de datos no cumple el contrato.',
      );
    }
    if (!payload.correcto) {
      if (typeof payload.codigo !== 'string') {
        throw new BadGatewayException(
          'La respuesta del servicio de datos no cumple el contrato.',
        );
      }
      throwRpcError(payload.codigo);
    }
    if (!Object.hasOwn(payload, 'datos')) {
      throw new BadGatewayException(
        'La respuesta del servicio de datos no cumple el contrato.',
      );
    }

    // El caso de uso validará la estructura concreta de sus datos de salida.
    return payload.datos;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function throwRpcError(code: string): never {
  switch (code) {
    case 'KVG01':
      throw new ConflictException(
        'Reasigna primero los expedientes a su cargo.',
      );
    case 'KVG02':
      throw new ConflictException(
        'Debe quedar una cuenta con administración y gestión de permisos.',
      );
    case '42501':
      throw new ForbiddenException('Operación no autorizada.');
    case '40001':
      throw new ConflictException(
        'El recurso fue modificado; actualiza la revisión.',
      );
    case '23505':
      throw new ConflictException('Existe un registro con la misma clave.');
    case 'P0002':
      throw new NotFoundException('Recurso no disponible.');
    case '22023':
    case '22P02':
    case '23502':
    case '23514':
      throw new BadRequestException(
        'La operación no cumple las reglas de datos.',
      );
    default:
      throw new BadGatewayException(
        'El servicio de datos no pudo completar la operación.',
      );
  }
}
