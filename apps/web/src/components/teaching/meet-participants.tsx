import type { attendance, Participant } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { Badge, type Tone } from "../ui/badge";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Checkbox } from "../ui/choice";
import { Sheet } from "../ui/dialog";
import { Select } from "../ui/field";
import { Skeleton } from "../ui/skeleton";
import { useSubmit } from "../use-submit";

type Candidates = Awaited<ReturnType<typeof listParticipants>>["candidates"];

const NOT_OURS = "none";

function listParticipants(meetingId: string, signal?: AbortSignal) {
  return api<typeof attendance.getParticipants>("GET", "/class-meetings/:id/participants", {
    params: { id: meetingId },
    ...(signal === undefined ? {} : { signal }),
  });
}

/** "1 h 5 min" / "12 min" / "under a minute". */
function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "under a minute";
  const h = Math.floor(minutes / 60);
  return h === 0 ? `${String(minutes)} min` : `${String(h)} h ${String(minutes % 60)} min`;
}

const KIND: Record<Participant["kind"], string> = {
  SIGNED_IN: "Google account",
  ANONYMOUS: "Guest (not signed in)",
  PHONE: "Phone",
};

/** Who the app thinks a participant is, as one badge (the word carries the meaning, UI-3). */
function matchBadge(p: Participant): { tone: Tone; word: string } {
  const { status, userId, role } = p.match;
  if (status === "SUGGESTED") return { tone: "warning", word: "Check this" };
  if (status === "UNMATCHED") return { tone: "danger", word: "Unknown" };
  if (userId === null) return { tone: "neutral", word: "Not on this course" };
  return role === "LECTURER"
    ? { tone: "neutral", word: "Lecturer" }
    : { tone: "success", word: "Counted" };
}

/** People still needing a decision first, then by name. */
function needsAttention(p: Participant): number {
  return p.match.status === "CONFIRMED" ? 1 : 0;
}

function MatchSheet({
  meetingId,
  participant,
  candidates,
  onClose,
}: {
  meetingId: string;
  participant: Participant | null;
  candidates: Candidates;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const submit = useSubmit();
  const [choice, setChoice] = useState<string>("");
  const [remember, setRemember] = useState(true);
  const open = participant !== null;
  const initial =
    participant?.match.userId ?? (participant?.match.status === "CONFIRMED" ? NOT_OURS : "");
  const value = choice === "" ? initial : choice;
  const canRemember = participant?.kind === "SIGNED_IN";
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setChoice("");
          onClose();
        }
      }}
      title={participant ? `Who is "${participant.displayName ?? KIND[participant.kind]}"?` : ""}
      description={
        participant
          ? `${KIND[participant.kind]} · in the call for ${duration(participant.seconds)}`
          : undefined
      }
      footer={
        <Button
          block
          loading={submit.busy}
          disabled={value === ""}
          onClick={() => {
            if (participant === null) return;
            void submit.run(async () => {
              await api<typeof attendance.matchParticipant>(
                "POST",
                "/class-meetings/:id/participants/:pid/match",
                {
                  params: { id: meetingId, pid: participant.participantId },
                  body: {
                    userId: value === NOT_OURS ? null : value,
                    remember: canRemember && value !== NOT_OURS && remember,
                  },
                },
              );
              await queryClient.invalidateQueries({ queryKey: ["participants", meetingId] });
              await queryClient.invalidateQueries({ queryKey: ["attendance", meetingId] });
              setChoice("");
              onClose();
            });
          }}
        >
          Save
        </Button>
      }
    >
      <div className="space-y-4">
        {participant?.match.status === "SUGGESTED" ? (
          <p className="text-body-sm text-ink">
            Their Google name matches {participant.match.name ?? "a student"}. They aren't counted
            until you confirm.
          </p>
        ) : null}
        <Select
          label="This is"
          value={value}
          onChange={(event) => {
            setChoice(event.target.value);
          }}
        >
          <option value="" disabled>
            Choose a person
          </option>
          <optgroup label="Students">
            {candidates
              .filter((c) => c.role === "STUDENT")
              .map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                  {c.matricNumber ? ` (${c.matricNumber})` : ""}
                </option>
              ))}
          </optgroup>
          <optgroup label="Lecturers (not counted)">
            {candidates
              .filter((c) => c.role === "LECTURER")
              .map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                </option>
              ))}
          </optgroup>
          <option value={NOT_OURS}>Someone not on this course</option>
        </Select>
        {canRemember && value !== NOT_OURS ? (
          <Checkbox
            label="Recognise this Google account in later classes"
            checked={remember}
            onChange={(event) => {
              setRemember(event.target.checked);
            }}
          />
        ) : null}
        {submit.problem ? (
          <p role="alert" className="text-body-sm text-danger">
            {submit.problem.title}. {submit.problem.body}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * The people Google Meet saw in the class (TRD §12.4, §12.7; integration slice). A name match is
 * only a suggestion; the Lecturer confirms it, says who an unknown participant is, or marks them
 * as not on the course. Only confirmed students are counted.
 */
export function MeetParticipants({ meetingId }: { meetingId: string }) {
  const participants = useQuery({
    queryKey: ["participants", meetingId],
    queryFn: ({ signal }) => listParticipants(meetingId, signal),
  });
  const [editing, setEditing] = useState<Participant | null>(null);
  if (participants.isPending) return <Skeleton className="h-32" />;
  if (participants.isError)
    return (
      <Banner tone="danger" title="We couldn't load the Meet participants">
        Reload the page to try again.
      </Banner>
    );
  const { items, candidates } = participants.data;
  const open = items.filter((p) => p.match.status !== "CONFIRMED").length;
  const sorted = [...items].sort(
    (a, b) =>
      needsAttention(a) - needsAttention(b) ||
      (a.displayName ?? "").localeCompare(b.displayName ?? ""),
  );
  return (
    <section aria-labelledby="meet-participants" className="space-y-3">
      <h2 id="meet-participants" className="text-title">
        In the Google Meet call
      </h2>
      {items.length === 0 ? (
        <p className="text-body-sm text-ink-muted">
          Nobody yet. Meet's list arrives a few minutes after the call ends.
        </p>
      ) : (
        <>
          <p className="text-body-sm text-ink">
            {open === 0
              ? "Everyone is identified."
              : `${String(open)} to check: confirm who they are so their time counts.`}
          </p>
          <Card list role="list">
            {sorted.map((p) => {
              const badge = matchBadge(p);
              return (
                <div
                  key={p.participantId}
                  role="listitem"
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body">{p.displayName ?? KIND[p.kind]}</p>
                    <p className="text-meta text-ink-muted">
                      {p.match.name ? `${p.match.name} · ` : ""}
                      {KIND[p.kind]} · {duration(p.seconds)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={badge.tone}>{badge.word}</Badge>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Who is ${p.displayName ?? KIND[p.kind]}?`}
                      onClick={() => {
                        setEditing(p);
                      }}
                    >
                      {p.match.status === "CONFIRMED" ? "Change" : "Identify"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card>
        </>
      )}
      <MatchSheet
        meetingId={meetingId}
        participant={editing}
        candidates={candidates}
        onClose={() => {
          setEditing(null);
        }}
      />
    </section>
  );
}
