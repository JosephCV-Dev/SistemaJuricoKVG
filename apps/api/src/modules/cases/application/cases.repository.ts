import type {
  AssignedCase,
  CaseAssignment,
  CaseAssignmentResult,
  CaseAssignmentSummary,
  CaseLawyer,
} from '@kvg/contracts';
import type {
  CaseRecord,
  CaseInformation,
  NewCase,
  CaseSearch,
  CaseUpdate,
  AssignedSearch,
  AssignmentChange,
  ReassignmentChange,
  ProgressInput,
  ProgressReference,
  StateChange,
  CaseState,
} from '../domain/case.types';
export abstract class CasesRepository {
  abstract assigned(
    token: string,
    input: AssignedSearch,
  ): Promise<AssignedCase[]>;
  abstract reassignable(
    token: string,
    input: CaseSearch,
  ): Promise<CaseAssignmentSummary[]>;
  abstract team(
    token: string,
    id: string,
    input: CaseSearch,
    forReassignment: boolean,
  ): Promise<
    CaseAssignmentSummary & {
      revision: number;
      assignments: CaseAssignment[];
      lawyers: CaseLawyer[];
    }
  >;
  abstract assign(
    token: string,
    id: string,
    input: AssignmentChange,
  ): Promise<CaseAssignmentResult>;
  abstract reassign(
    token: string,
    id: string,
    input: ReassignmentChange,
  ): Promise<CaseAssignmentResult>;
  abstract changeState(
    token: string,
    id: string,
    input: StateChange,
  ): Promise<{ caseId: string; status: CaseState; revision: number }>;
  abstract addProgress(
    token: string,
    id: string,
    input: ProgressInput,
  ): Promise<{ id: string }>;
  abstract progressReferences(
    token: string,
    id: string,
    input: CaseSearch,
  ): Promise<ProgressReference[]>;
  abstract create(token: string, input: NewCase): Promise<CaseRecord>;
  abstract update(
    token: string,
    id: string,
    input: CaseUpdate,
  ): Promise<CaseRecord>;
  abstract get(token: string, id: string): Promise<CaseInformation>;
  abstract search(token: string, input: CaseSearch): Promise<CaseRecord[]>;
}
