import type { ApplicationSection } from "@glim/contracts";
import type { schema } from "@glim/db";

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
