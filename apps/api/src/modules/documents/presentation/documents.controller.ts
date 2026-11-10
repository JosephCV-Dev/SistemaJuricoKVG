import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UnsupportedMediaTypeException,
  PayloadTooLargeException,
  BadRequestException,
  ServiceUnavailableException,
  HttpCode,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequirePermission } from '../../identity/presentation/access.decorators';
import { CsrfGuard } from '../../identity/presentation/csrf.guard';
import { userAccessToken } from '../../identity/presentation/user-access-token';
import { RecordIdDto } from '../../../common/dto/record.dto';
import { DocumentsService } from '../application/documents.service';
import { MAX_FILE_BYTES } from '../domain/document.types';
import { CreateUploadDto, SearchDocumentsDto } from './documents.dto';
const scope = ['PRINCIPAL', 'COLABORADOR', 'EXPLICITO'];
@Controller('documents')
export class DocumentsController {
  private receiving = 0;
  private downloading = 0;
  constructor(private readonly documents: DocumentsService) {}
  @Post('uploads')
  @UseGuards(CsrfGuard)
  @RequirePermission('documento.cargar', scope)
  create(@Body() input: CreateUploadDto, @Req() req: Request) {
    return this.documents.create(userAccessToken(req), input);
  }
  @Get('categories')
  @RequirePermission('documento.cargar', scope)
  categories(@Req() req: Request) {
    return this.documents.repository.categories(userAccessToken(req));
  }
  @Get('uploads/:id')
  @RequirePermission('documento.cargar', scope)
  status(@Param() p: RecordIdDto, @Req() req: Request) {
    return this.documents.repository.upload(userAccessToken(req), p.id);
  }
  @Put('uploads/:id/content')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @RequirePermission('documento.cargar', scope)
  async receive(@Param() p: RecordIdDto, @Req() req: Request) {
    const token = userAccessToken(req);
    await this.documents.repository.upload(token, p.id); // Antes de consumir bytes.
    if (req.headers['content-type'] !== 'application/octet-stream')
      throw new UnsupportedMediaTypeException(
        'Envía el archivo como contenido binario.',
      );
    if (this.receiving >= 2)
      throw new ServiceUnavailableException(
        'Hay otras cargas en curso; vuelve a intentarlo.',
      );
    if (Number(req.headers['content-length']) > MAX_FILE_BYTES)
      throw new PayloadTooLargeException('Máximo 20 MB.');
    this.receiving++;
    const timeout = setTimeout(() => req.destroy(), 30_000);
    try {
      let length = 0;
      const chunks: Buffer[] = [];
      for await (const value of req) {
        const chunk = Buffer.from(value as Uint8Array);
        length += chunk.length;
        if (length > MAX_FILE_BYTES)
          throw new PayloadTooLargeException('Máximo 20 MB.');
        chunks.push(chunk);
      }
      if (!length) throw new BadRequestException('El archivo está vacío.');
      return await this.documents.receive(token, p.id, Buffer.concat(chunks));
    } finally {
      clearTimeout(timeout);
      this.receiving--;
    }
  }
  @Get()
  @RequirePermission('documento.consultar', scope)
  search(@Query() q: SearchDocumentsDto, @Req() req: Request) {
    return this.documents.repository.search(
      userAccessToken(req),
      q.caseId,
      q.offset,
    );
  }
  @Get('versions/:id/download')
  @RequirePermission('documento.descargar', scope)
  async download(
    @Param() p: RecordIdDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (this.downloading >= 2)
      throw new ServiceUnavailableException(
        'Hay otras descargas en curso; vuelve a intentarlo.',
      );
    this.downloading++;
    try {
      const bytes = await this.documents.download(userAccessToken(req), p.id);
      if (res.destroyed) return;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="KVG-${p.id}"`,
      );
      res.setHeader('Content-Length', bytes.length);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => res.destroy(), 60_000);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        res.once('finish', done);
        res.once('close', done);
        res.send(bytes);
      });
    } finally {
      this.downloading--;
    }
    // La autorización no afirma recepción efectiva por el cliente.
  }
  @Get(':id')
  @RequirePermission('documento.consultar', scope)
  get(@Param() p: RecordIdDto, @Req() req: Request) {
    return this.documents.repository.get(userAccessToken(req), p.id);
  }
}
