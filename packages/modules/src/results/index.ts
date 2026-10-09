export { ResultsModule } from "./results.module";
export { CourseResultsService } from "./course-results.service";
export {
  GradingSchemesService,
  rulesOf,
  type SchemeChange,
  type SchemeInput,
} from "./grading-schemes.service";
export * from "./domain/grading";
export { SemesterResultsService, type SemesterScope } from "./semester-results.service";
export { recordImportedResult, type ImportedResult } from "./legacy";
