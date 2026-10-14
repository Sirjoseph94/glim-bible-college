import type { CurrentIntake } from "@glim/contracts";
import { CalendarDate } from "../time";
import { Banner } from "../ui/banner";

/** Where the Intake stands, in one sentence (TRD §10.2): on the apply and landing pages. */
export function IntakeStatus({ intake }: { intake: CurrentIntake["intake"] }) {
  if (intake === null)
    return <p className="text-body">There's no intake scheduled yet. Please check back soon.</p>;
  if (intake.status === "OPEN")
    return (
      <p className="text-body">
        Applications for the <strong>{intake.academicSessionName}</strong> are open until{" "}
        <strong>
          <CalendarDate value={intake.closesOn} />
        </strong>
        .
      </p>
    );
  if (intake.status === "PLANNED")
    return (
      <p className="text-body">
        Applications for the <strong>{intake.academicSessionName}</strong> open on{" "}
        <strong>
          <CalendarDate value={intake.opensOn} />
        </strong>
        .
      </p>
    );
  return (
    <Banner tone="warning">
      Applications for the {intake.academicSessionName} are closed. You can't start an application
      now.
    </Banner>
  );
}
