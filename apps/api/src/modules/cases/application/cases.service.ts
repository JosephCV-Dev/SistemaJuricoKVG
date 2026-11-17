import { Injectable } from '@nestjs/common';
import { CasesRepository } from './cases.repository';
import type { NewCase, CaseSearch, CaseUpdate } from '../domain/case.types';
@Injectable()
export class CasesService {
  constructor(private readonly cases: CasesRepository) {}
  create(token: string, input: NewCase) {
    return this.cases.create(token, input);
  }
  update(token: string, id: string, input: CaseUpdate) {
    return this.cases.update(token, id, input);
  }
  get(token: string, id: string) {
    return this.cases.get(token, id);
  }
  async search(token: string, input: CaseSearch) {
    const rows = await this.cases.search(token, {
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
