import type { Application, ApplicationSection } from "@glim/contracts";
import type { Database, schema } from "@glim/db";
import type { StudentsService } from "@glim/modules/enrollment";

type ApplicationRow = typeof schema.applications.$inferSelect;

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v === "");

/**
 * Required fields still unanswered, per section (TRD §10.2: everything is required unless the
 * paper form marks it optional). The wizard shows progress from this, and submitting needs it empty.
 */
export function missingFields(row: ApplicationRow): Record<ApplicationSection, string[]> {
  const spiritual = row.spiritualBackground ?? {};
  const missing = (fields: Record<string, unknown>) =>
    Object.entries(fields)
      .filter(([, v]) => blank(v))
      .map(([k]) => k);
  return {
    personal: missing({
      firstName: row.firstName,
      lastName: row.lastName,
      title: row.title,
      ...(row.title === "OTHER" ? { titleOther: row.titleOther } : {}),
      gender: row.gender,
      dateOfBirth: row.dateOfBirth,
      maritalStatus: row.maritalStatus,
      nationality: row.nationality,
      occupation: row.occupation,
    }),
    contact: missing({ email: row.email, phoneWhatsapp: row.phoneWhatsapp }),
    address: missing({
      country: row.country,
      stateProvince: row.stateProvince,
      city: row.city,
      address: row.address,
    }),
    church: missing({
      churchName: row.churchName,
      churchAddress: row.churchAddress,
      pastorName: row.pastorName,
      pastorPhone: row.pastorPhone,
    }),
    spiritual: missing({
      bornAgain: spiritual.bornAgain,
      ...(spiritual.bornAgain === true ? { bornAgainWhen: spiritual.bornAgainWhen } : {}),
      waterBaptism: spiritual.waterBaptism,
      holySpiritBaptism: spiritual.holySpiritBaptism,
      ...(spiritual.holySpiritBaptism === true
        ? { holySpiritSince: spiritual.holySpiritSince }
        : {}),
    }),
    feedback: [
      ...(row.heardVia.length === 0 ? ["heardVia"] : []),
      ...(row.heardVia.includes("OTHER") && blank(row.heardViaOther) ? ["heardViaOther"] : []),
    ],
    declaration: [
      ...(blank(row.declarationFullName) ? ["fullName"] : []),
      ...(row.statementOfFaithRead ? [] : ["statementOfFaithRead"]),
      ...(row.declaredAt === null ? ["declared"] : []),
    ],
    consent: row.dataConsentAt === null ? ["consented"] : [],
    photo: row.photoFileId === null ? ["fileId"] : [],
  };
}

/** Whole years from a date of birth to a day, both ISO dates (a birthday counts on the day). */
export function ageOn(dateOfBirth: string, on: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const [y, m, d] = on.split("-").map(Number) as [number, number, number];
  const beforeBirthday = m < bm || (m === bm && d < bd);
  return y - by - (beforeBirthday ? 1 : 0);
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

/** The form's sections as the API shows them (applicant and staff views alike). */
export function formAnswers(
  r: ApplicationRow,
): Pick<
  Application,
  | "personal"
  | "contact"
  | "address"
  | "church"
  | "spiritual"
  | "feedback"
  | "declaration"
  | "consent"
  | "photo"
> {
  const spiritual = r.spiritualBackground ?? {};
  return {
    personal: {
      firstName: r.firstName,
      middleName: r.middleName,
      lastName: r.lastName,
      title: r.title as Application["personal"]["title"],
      titleOther: r.titleOther,
      gender: r.gender as Application["personal"]["gender"],
      dateOfBirth: r.dateOfBirth,
      maritalStatus: r.maritalStatus as Application["personal"]["maritalStatus"],
      nationality: r.nationality,
      occupation: r.occupation,
    },
    contact: {
      email: r.email,
      phoneWhatsapp: r.phoneWhatsapp,
      altPhoneWhatsapp: r.altPhoneWhatsapp,
    },
    address: {
      country: r.country,
      stateProvince: r.stateProvince,
      city: r.city,
      postcode: r.postcode,
      address: r.address,
    },
    church: {
      churchName: r.churchName,
      churchAddress: r.churchAddress,
      pastorName: r.pastorName,
      pastorPhone: r.pastorPhone,
    },
    spiritual: {
      bornAgain: spiritual.bornAgain ?? null,
      bornAgainWhen: spiritual.bornAgainWhen ?? null,
      waterBaptism: spiritual.waterBaptism ?? null,
      holySpiritBaptism: spiritual.holySpiritBaptism ?? null,
      holySpiritSince: spiritual.holySpiritSince ?? null,
    },
    feedback: {
      heardVia: r.heardVia as Application["feedback"]["heardVia"],
      heardViaOther: r.heardViaOther,
      referralCode: r.referralCodeEntered,
    },
    declaration: {
      fullName: r.declarationFullName,
      statementOfFaithRead: r.statementOfFaithRead,
      declaredAt: iso(r.declaredAt),
    },
    consent: { consentedAt: iso(r.dataConsentAt) },
    photo:
      r.photoFileId === null
        ? null
        : { fileId: r.photoFileId, downloadPath: `/api/v1/files/${r.photoFileId}/download` },
  };
}

/** The offer (once admitted) and the Matric Number (once accepted), for both views. */
export async function offerAndEnrollment(
  r: ApplicationRow,
  db: Database,
  students: StudentsService,
): Promise<Pick<Application, "offer" | "enrollment">> {
  const matricNumber =
    r.status === "ACCEPTED" ? await students.matricForApplication(r.id, db) : null;
  return {
    offer: r.offerExpiresAt === null ? null : { expiresAt: r.offerExpiresAt.toISOString() },
    enrollment: matricNumber === null ? null : { matricNumber },
  };
}
