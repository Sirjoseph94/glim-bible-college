import * as academic from "./academic";
import * as audit from "./audit";
import * as auth from "./auth";
import * as calendar from "./calendar";
import * as me from "./me";
import * as platform from "./platform";
import * as settings from "./settings";
import * as users from "./users";

export { academic, audit, auth, calendar, me, platform, settings, users };

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
] as const;
export type { Course, Curriculum, CurriculumDetail, Programme } from "./academic";
export type { AuditLogItem } from "./audit";
export type { AcademicSession, Room, Semester } from "./calendar";
export type { Me } from "./me";
export type { PolicyView, Settings } from "./settings";
export type { UserDetail, UserListItem } from "./users";
