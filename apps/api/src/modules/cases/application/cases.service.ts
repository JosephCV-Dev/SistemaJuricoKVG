import { Injectable } from '@nestjs/common';
import { CasesRepository } from './cases.repository';
import type {
  NewCase,
  CaseSearch,
  CaseUpdate,
  AssignedSearch,
  AssignmentChange,
  ReassignmentChange,
  StateChange,
  ProgressInput,
} from '../domain/case.types';
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
  assign(token: string, id: string, input: AssignmentChange) {
    return this.cases.assign(token, id, input);
  }
  reassign(token: string, id: string, input: ReassignmentChange) {
    return this.cases.reassign(token, id, input);
  }
  async assigned(token: string, input: AssignedSearch) {
    return this.page(
      await this.cases.assigned(token, { ...input, limit: input.limit + 1 }),
      input,
    );
  }
  async reassignable(token: string, input: CaseSearch) {
    return this.page(
      await this.cases.reassignable(token, {
        ...input,
        limit: input.limit + 1,
      }),
      input,
    );
  }
  async team(
    token: string,
    id: string,
    input: CaseSearch,
    forReassignment: boolean,
  ) {
    const { lawyers, ...team } = await this.cases.team(
      token,
      id,
      { ...input, limit: input.limit + 1 },
      forReassignment,
    );
    return { ...team, lawyers: this.page(lawyers, input) };
  }
  changeState(token: string, id: string, input: StateChange) {
    return this.cases.changeState(token, id, input);
  }
  addProgress(token: string, id: string, input: ProgressInput) {
    return this.cases.addProgress(token, id, input);
  }
  async progressReferences(token: string, id: string, input: CaseSearch) {
    return this.page(
      await this.cases.progressReferences(token, id, {
        ...input,
        limit: input.limit + 1,
      }),
      input,
    );
  }
  async search(token: string, input: CaseSearch) {
    return this.page(
      await this.cases.search(token, { ...input, limit: input.limit + 1 }),
      input,
    );
  }
  private page<T>(rows: T[], input: CaseSearch) {
    return {
      items: rows.slice(0, input.limit),
      limit: input.limit,
      offset: input.offset,
      hasMore: rows.length > input.limit && input.offset + input.limit <= 10000,
    };
  }
}
