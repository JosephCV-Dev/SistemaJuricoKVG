import { Injectable } from '@nestjs/common';
import { ClientsRepository } from './clients.repository';
import type { NewClient, ClientSearch } from '../domain/client.types';

@Injectable()
export class ClientsService {
  constructor(private readonly clients: ClientsRepository) {}
  register(token: string, input: NewClient) {
    return this.clients.register(token, input);
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
      hasMore: rows.length > input.limit,
    };
  }
}
