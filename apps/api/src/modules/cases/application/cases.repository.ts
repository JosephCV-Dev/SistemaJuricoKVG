import type {
  CaseRecord,
  CaseInformation,
  NewCase,
  CaseSearch,
} from '../domain/case.types';
export abstract class CasesRepository {
  abstract create(token: string, input: NewCase): Promise<CaseRecord>;
  abstract get(token: string, id: string): Promise<CaseInformation>;
  abstract search(token: string, input: CaseSearch): Promise<CaseRecord[]>;
}
