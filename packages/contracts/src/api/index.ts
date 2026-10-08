import * as academic from "./academic";
import * as admissions from "./admissions";
import * as applications from "./applications";
import * as attendance from "./attendance";
import * as audit from "./audit";
import * as auth from "./auth";
import * as calendar from "./calendar";
import * as enrollment from "./enrollment";
import * as files from "./files";
import * as imports from "./imports";
import * as me from "./me";
import * as meetings from "./meetings";
import * as offerings from "./offerings";
import * as platform from "./platform";
import * as reports from "./reports";
import * as settings from "./settings";
import * as users from "./users";
import * as video from "./video";

export {
  academic,
  admissions,
  applications,
  attendance,
  audit,
  auth,
  calendar,
  enrollment,
  files,
  imports,
  me,
  meetings,
  offerings,
  platform,
  reports,
  settings,
  users,
  video,
};

/** Every endpoint, for the OpenAPI document and the route-coverage test. */
export const ENDPOINTS = [
  platform.getInstitution,
  me.getMe,
  me.updateMe,
  enrollment.getMyRegistration,
  enrollment.getSemesterRegistration,
  enrollment.addElective,
  enrollment.dropElective,
  enrollment.getRoster,
  enrollment.registerManually,
  enrollment.withdrawCourseEnrollment,
  meetings.createClassMeeting,
  meetings.listClassMeetings,
  meetings.getClassMeeting,
  meetings.updateClassMeeting,
  meetings.cancelClassMeeting,
  meetings.createClassMeetingSeries,
  meetings.joinClassMeeting,
  meetings.startClassMeeting,
  meetings.endClassMeeting,
  attendance.getRollCall,
  attendance.putRollCall,
  attendance.getMeetingAttendance,
  attendance.getMyAttendance,
  attendance.overrideAttendance,
  attendance.clearAttendanceOverride,
  attendance.getAttendanceReport,
  video.listVideos,
  video.getVideo,
  video.addVideo,
  video.updateVideo,
  video.publishVideo,
  video.unpublishVideo,
  video.reorderVideos,
  meetings.getMySchedule,
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
  admissions.listApplications,
  admissions.getReviewedApplication,
  admissions.startReview,
  admissions.addApplicationNote,
  admissions.decideApplication,
  admissions.reopenOffer,
  admissions.exportApplications,
  reports.getAdmissionsReport,
  reports.getReferralReport,
  applications.startApplication,
  applications.myApplications,
  applications.getApplication,
  applications.saveApplicationDraft,
  applications.submitApplication,
  applications.withdrawApplication,
  applications.acceptOffer,
  files.createUpload,
  files.completeUpload,
  files.downloadFile,
  imports.startImport,
  imports.listImports,
  imports.getImport,
  imports.getImportTemplate,
] as const;
export type { Course, Curriculum, CurriculumDetail, Programme } from "./academic";
export type { CurrentIntake, Intake } from "./admissions";
export {
  APPLICATION_SECTIONS,
  type Application,
  type ApplicationDraft,
  type ApplicationSection,
  type ApplicationQueueItem,
  type ApplicationSummary,
  type ReviewedApplication,
} from "./applications";
export type {
  AttendanceReport,
  MeetingAttendance,
  MyAttendance,
  RollCall,
  RollCallMark,
} from "./attendance";
export type { AuditLogItem } from "./audit";
export type { AcademicSession, Room, Semester } from "./calendar";
export { UPLOAD_PURPOSES, type FileView, type UploadPurpose } from "./files";
export { IMPORT_KINDS, type ImportJob, type ImportKind } from "./imports";
export type { MyRegistration, RosterItem, SemesterRegistration } from "./enrollment";
export type { Me } from "./me";
export {
  MEET_LINK_PATTERN,
  type ClassMeeting,
  type ClassMeetingSeries,
  type ScheduleWarning,
} from "./meetings";
export type { AdmissionsReport, ReferralReport } from "./reports";
export type { Lecturer, Offering } from "./offerings";
export type { PolicyView, Settings } from "./settings";
export type { UserDetail, UserListItem } from "./users";
export type { Video } from "./video";
