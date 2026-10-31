export { ResultsModule } from "./results.module";
export { CourseResultsService } from "./course-results.service";
export {
  GradingSchemesService,
  rulesOf,
  type SchemeChange,
  type SchemeInput,
} from "./grading-schemes.service";
export * from "./domain/grading";
export { CohortResultsService, type ApprovalScope } from "./cohort-results.service";
export * from "./domain/awards";
export { lineOf, summarize } from "./summary";
export { recordImportedResult, type ImportedResult } from "./legacy";
export { AwardsService } from "./awards.service";
