import * as academic from "./academic";
import * as admissions from "./admissions";
import * as applications from "./applications";
import * as audit from "./audit";
import * as auth from "./auth";
import * as calendar from "./calendar";
import * as files from "./files";
import * as me from "./me";
import * as offerings from "./offerings";
import * as platform from "./platform";
import * as settings from "./settings";
import * as users from "./users";

export {
  academic,
  admissions,
  applications,
  audit,
  auth,
  calendar,
  files,
  me,
  offerings,
  platform,
  settings,
  users,
};

/** Every endpoint, for the OpenAPI document and the route-coverage test. */
export const ENDPOINTS = [
  platform.getInstitution,
  me.getMe,
  me.updateMe,
  auth.login,
  auth.logout,
  auth.forgotPassword,
  auth.resetPassword,
  auth.acceptInvite,
  auth.googleStart,
  auth.googleCallback,
  users.listUsers,
  users.inviteUser,
  users.getUser,
  users.updateUser,
  users.deactivateUser,
  users.resendInvite,
  users.assignRole,
  users.revokeRole,
  audit.listAuditLogs,
  settings.getSettings,
  settings.updateSettings,
  settings.listPolicies,
  settings.getPolicy,
  settings.putPolicy,
  academic.listProgrammes,
  academic.createProgramme,
  academic.updateProgramme,
  academic.listCourses,
  academic.createCourse,
  academic.updateCourse,
  academic.listCurricula,
  academic.getCurriculum,
  academic.createCurriculum,
  academic.updateCurriculum,
  academic.putPlacements,
  academic.activateCurriculum,
  academic.cloneCurriculum,
  calendar.listAcademicSessions,
  calendar.createAcademicSession,
  calendar.updateAcademicSession,
  calendar.activateAcademicSession,
  calendar.closeAcademicSession,
  calendar.listSemesters,
  calendar.createSemester,
  calendar.updateSemester,
  calendar.openSemesterRegistration,
  calendar.activateSemester,
  calendar.closeSemester,
  calendar.listRooms,
  calendar.createRoom,
  calendar.updateRoom,
  offerings.listLecturers,
  offerings.createLecturer,
  offerings.updateLecturer,
  offerings.listOfferings,
  offerings.createOffering,
  offerings.getOffering,
  offerings.updateOffering,
  offerings.publishOffering,
  offerings.cancelOffering,
  offerings.listOfferingLecturers,
  offerings.assignLecturer,
  offerings.endAssignment,
  admissions.listIntakes,
  admissions.createIntake,
  admissions.updateIntake,
  admissions.openIntake,
  admissions.closeIntake,
  admissions.getCurrentIntake,
  applications.startApplication,
  applications.myApplications,
  applications.getApplication,
  applications.saveApplicationDraft,
  applications.submitApplication,
  applications.withdrawApplication,
  files.createUpload,
  files.completeUpload,
  files.downloadFile,
] as const;
export type { Course, Curriculum, CurriculumDetail, Programme } from "./academic";
export type { CurrentIntake, Intake } from "./admissions";
export {
  APPLICATION_SECTIONS,
  type Application,
  type ApplicationDraft,
  type ApplicationSection,
  type ApplicationSummary,
} from "./applications";
export type { AuditLogItem } from "./audit";
export type { AcademicSession, Room, Semester } from "./calendar";
export { UPLOAD_PURPOSES, type FileView, type UploadPurpose } from "./files";
export type { Me } from "./me";
export type { Lecturer, Offering } from "./offerings";
export type { PolicyView, Settings } from "./settings";
export type { UserDetail, UserListItem } from "./users";
