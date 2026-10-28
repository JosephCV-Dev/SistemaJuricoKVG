import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorResponse } from '@kvg/contracts';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Ocurrió un error interno.';

    if (exception instanceof HttpException && statusCode < 500) {
      const detail = exception.getResponse();
      if (typeof detail === 'string') {
        message = detail;
      } else if ('message' in detail) {
        const candidate: unknown = detail.message;
        if (typeof candidate === 'string') message = candidate;
        if (
          Array.isArray(candidate) &&
          candidate.every((item) => typeof item === 'string')
        ) {
          message = candidate;
        }
      }
    }

    if (statusCode >= 500) {
      // No registrar objetos de excepción que puedan contener credenciales o datos jurídicos.
      this.logger.error('La petición terminó con un error interno.');
    }

    const body: ApiErrorResponse = {
      statusCode,
      message,
      timestamp: new Date().toISOString(),
    };
    response.status(statusCode).json(body);
  }
}
