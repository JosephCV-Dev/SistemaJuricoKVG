import { ForbiddenException, Injectable } from '@nestjs/common';
import { ClientsRepository } from './clients.repository';
import type {
  NewClient,
  ClientSearch,
  ClientUpdate,
} from '../domain/client.types';

@Injectable()
export class ClientsService {
  constructor(private readonly clients: ClientsRepository) {}
  register(token: string, input: NewClient) {
    return this.clients.register(token, input);
  }
  update(token: string, id: string, input: ClientUpdate) {
    return this.clients.update(token, id, input);
  }
  async editIdentificationTypes(token: string, id: string) {
    if (!(await this.clients.get(token, id)).canEdit)
      throw new ForbiddenException('Operación no autorizada.');
    return this.clients.identificationTypes(token);
  }
  get(token: string, id: string) {
    return this.clients.get(token, id);
  }
  identificationTypes(token: string) {
    return this.clients.identificationTypes(token);
  }
  async search(token: string, input: ClientSearch) {
    const rows = await this.clients.search(token, {
      ...input,
      limit: input.limit + 1,
    });
    return {
      items: rows.slice(0, input.limit),
      limit: input.limit,
      offset: input.offset,
      hasMore: rows.length > input.limit && input.offset + input.limit <= 10000,
    };
  }
}
