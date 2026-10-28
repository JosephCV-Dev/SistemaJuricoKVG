import type {
  Client,
  ClientInformation,
  NewClient,
  ClientSearch,
  IdentificationDefinition,
} from '../domain/client.types';

export abstract class ClientsRepository {
  abstract register(token: string, input: NewClient): Promise<Client>;
  abstract get(token: string, id: string): Promise<ClientInformation>;
  abstract search(token: string, input: ClientSearch): Promise<Client[]>;
  abstract identificationTypes(
    token: string,
  ): Promise<IdentificationDefinition[]>;
}
