import type { Announcement, BodyOf, content, Material } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../api/client";
import { fileSize } from "../design/format";
import { Icon, type IconName } from "../design/icons";
import { formText } from "./form";
import { LoadFailed } from "./app/page-states";
import { Time } from "./time";
import { Badge } from "./ui/badge";
import { Banner } from "./ui/banner";
import { Button, buttonClass } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox, Radio } from "./ui/choice";
import { ConfirmDialog, Sheet } from "./ui/dialog";
import { EmptyState } from "./ui/empty-state";
import { TextField } from "./ui/field";
import { ProgressBar } from "./ui/progress-bar";
import { Skeleton, SkeletonGroup } from "./ui/skeleton";
import { uploadFile } from "./upload";
import { useSubmit } from "./use-submit";

const materialsKey = (offeringId: string) => ["materials", offeringId];
const announcementsKey = (offeringId: string) => ["announcements", offeringId];

/** HTML from the server, rendered from Markdown and sanitized there with an allow-list (§14.1). */
export function SafeHtml({ html }: { html: string }) {
  return (
    <div
      className="max-w-prose space-y-2 text-body [&_a]:text-brand [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      // Sanitized on the server (renderMarkdown), so it is safe to insert as it is.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const KIND_ICON: Record<Material["kind"], IconName> = {
  FILE: "download",
  LINK: "book",
  TEXT: "file",
};

function MaterialBody({ material: m }: { material: Material }) {
  if (m.kind === "FILE" && m.file !== null)
    return (
      <a
        href={m.file.downloadPath}
        className={`${buttonClass({ variant: "secondary", size: "sm" })} max-w-full`}
      >
        <Icon name="download" size={16} />
        <span className="truncate">Download {m.file.name}</span>
        <span className="text-ink-muted">{fileSize(m.file.sizeBytes)}</span>
      </a>
    );
  if (m.kind === "LINK" && m.url !== null)
    return (
      <a
        href={m.url}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        Open link
      </a>
    );
  return m.bodyHtml === null ? null : <SafeHtml html={m.bodyHtml} />;
}

/**
 * A course's materials, grouped by section (TRD §14.1). With `manage`, the course's staff also
 * see drafts and scheduled ones, and can add and remove them.
 */
export function CourseMaterials({ offeringId, manage }: { offeringId: string; manage: boolean }) {
  const list = useQuery({
    queryKey: materialsKey(offeringId),
    queryFn: ({ signal }) =>
      api<typeof content.listMaterials>("GET", "/course-offerings/:id/materials", {
        params: { id: offeringId },
        signal,
      }),
  });
  const items = list.data?.items ?? [];
  const sections = new Map<string, Material[]>();
  for (const m of items) {
    const label = m.sectionLabel ?? "General";
    sections.set(label, [...(sections.get(label) ?? []), m]);
  }
  return (
    <div className="space-y-5">
      {manage ? <AddMaterial offeringId={offeringId} /> : null}
      {list.isPending ? (
        <SkeletonGroup label="Loading materials">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the materials" onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="file" title="No materials yet">
          {manage
            ? "Add files, links or notes with the button above."
            : "Handouts, links and notes for this course appear here."}
        </EmptyState>
      ) : (
        [...sections].map(([label, materials]) => (
          <section key={label} className="space-y-2">
            <h2 className="text-heading">{label}</h2>
            <Card list role="list">
              {materials.map((m) => (
                <MaterialItem key={m.id} material={m} manage={manage} offeringId={offeringId} />
              ))}
            </Card>
          </section>
        ))
      )}
    </div>
  );
}

function MaterialItem({
  material: m,
  manage,
  offeringId,
}: {
  material: Material;
  manage: boolean;
  offeringId: string;
}) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const scheduled = m.publishAt !== null && new Date(m.publishAt) > new Date();
  return (
    <div role="listitem" aria-label={m.title} className="flex gap-3 px-4 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
        <Icon name={KIND_ICON[m.kind]} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-subhead text-ink">{m.title}</p>
          {m.status === "DRAFT" ? <Badge status="draft" /> : null}
          {m.visibility === "STAFF_ONLY" ? <Badge tone="neutral">Staff only</Badge> : null}
          {manage && scheduled ? <Badge tone="info">Scheduled</Badge> : null}
        </div>
        {manage && scheduled && m.publishAt !== null ? (
          <p className="text-meta text-ink-muted">
            Shown to students from <Time value={m.publishAt} />
          </p>
        ) : null}
        <MaterialBody material={m} />
      </div>
      {manage ? (
        <>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setRemoving(true);
            }}
          >
            Remove
          </Button>
          <ConfirmDialog
            open={removing}
            onOpenChange={setRemoving}
            title={`Remove "${m.title}"?`}
            confirmLabel="Remove material"
            tone="danger"
            onConfirm={async () => {
              await api<typeof content.deleteMaterial>("DELETE", "/course-materials/:id", {
                params: { id: m.id },
              });
              setRemoving(false);
              await queryClient.invalidateQueries({ queryKey: materialsKey(offeringId) });
            }}
          >
            It leaves the course: students no longer see it, and it goes from this list. Any file
            stays on the college's records.
          </ConfirmDialog>
        </>
      ) : null}
    </div>
  );
}

const KIND_LABEL: Record<Material["kind"], string> = { FILE: "File", LINK: "Link", TEXT: "Text" };

/** "Add material": a primary button opening a Sheet with the form (§10.2). */
function AddMaterial({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Material["kind"]>("FILE");
  const [progress, setProgress] = useState<number | null>(null);
  const formId = useId();

  const submit = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const title = formText(data, "title");
    const sectionText = formText(data, "sectionLabel");
    const publishAt = formText(data, "publishAt");
    const common = {
      title,
      sectionLabel: sectionText === "" ? null : sectionText,
      ...(publishAt === "" ? {} : { publishAt: new Date(publishAt).toISOString() }),
      ...(data.get("staffOnly") === "on" ? { visibility: "STAFF_ONLY" as const } : {}),
    };
    void run(async () => {
      let body: BodyOf<typeof content.createMaterial>;
      if (kind === "FILE") {
        const file = data.get("file");
        if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file.");
        setProgress(0);
        const fileId = await uploadFile(
          file,
          { name: file.name, mime: file.type || "application/octet-stream", purpose: "MATERIAL" },
          setProgress,
        );
        body = { kind, fileId, ...common };
      } else if (kind === "LINK") body = { kind, url: formText(data, "url"), ...common };
      else body = { kind, bodyMd: formText(data, "bodyMd"), ...common };
      await api<typeof content.createMaterial>("POST", "/course-offerings/:id/materials", {
        params: { id: offeringId },
        body,
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      await queryClient.invalidateQueries({ queryKey: materialsKey(offeringId) });
      setOpen(false);
    }).finally(() => {
      setProgress(null);
    });
  };

  return (
    <>
      <Button
        variant="primary"
        icon="upload"
        onClick={() => {
          setOpen(true);
        }}
      >
        Add material
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Add material"
        description="A file, a link or some notes. Students see it once it's shown."
        footer={
          <Button type="submit" form={formId} variant="primary" block loading={busy}>
            Add material
          </Button>
        }
      >
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget);
          }}
        >
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          <fieldset>
            <legend className="text-label text-ink">Kind</legend>
            <div className="flex flex-wrap gap-x-5">
              {(["FILE", "LINK", "TEXT"] as const).map((k) => (
                <Radio
                  key={k}
                  name="kind"
                  label={KIND_LABEL[k]}
                  checked={kind === k}
                  onChange={() => {
                    setKind(k);
                  }}
                />
              ))}
            </div>
          </fieldset>
          <TextField name="title" label="Title" required error={fieldErrors.title} />
          <TextField
            name="sectionLabel"
            label="Section"
            optional
            hint="e.g. Week 1"
            error={fieldErrors.sectionLabel}
          />
          {kind === "FILE" ? (
            <div className="space-y-2">
              <TextField name="file" type="file" label="File (up to 100 MB)" required />
              {progress !== null ? <ProgressBar label="Uploading" value={progress * 100} /> : null}
            </div>
          ) : kind === "LINK" ? (
            <TextField name="url" label="Web address" type="url" required error={fieldErrors.url} />
          ) : (
            <TextField
              name="bodyMd"
              label="Text (Markdown)"
              multiline
              rows={5}
              required
              error={fieldErrors.bodyMd}
            />
          )}
          <TextField
            name="publishAt"
            type="datetime-local"
            label="Show to students from"
            optional
            hint="Leave empty to show it now."
          />
          <Checkbox name="staffOnly" label="Staff only" />
        </form>
      </Sheet>
    </>
  );
}

/** A course's announcements, pinned first (§14.1); the course's staff post, pin and delete. */
export function CourseAnnouncements({
  offeringId,
  manage,
}: {
  offeringId: string;
  manage: boolean;
}) {
  const list = useQuery({
    queryKey: announcementsKey(offeringId),
    queryFn: ({ signal }) =>
      api<typeof content.listAnnouncements>("GET", "/course-offerings/:id/announcements", {
        params: { id: offeringId },
        signal,
      }),
  });
  const items = list.data?.items ?? [];
  return (
    <div className="space-y-4">
      {manage ? <NewAnnouncement offeringId={offeringId} /> : null}
      {list.isPending ? (
        <SkeletonGroup label="Loading announcements">
          <Skeleton className="h-24" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the announcements" onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title="No announcements yet" headingLevel={3}>
          {manage
            ? "Post one with the button above; students on the course see it in their notifications."
            : "News from your Lecturer appears here."}
        </EmptyState>
      ) : (
        <Card list role="list">
          {items.map((a) => (
            <AnnouncementItem key={a.id} announcement={a} manage={manage} offeringId={offeringId} />
          ))}
        </Card>
      )}
    </div>
  );
}

/** "New announcement": a primary button opening a Sheet with the form. */
function NewAnnouncement({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const formId = useId();
  return (
    <>
      <Button
        variant="primary"
        icon="bell"
        onClick={() => {
          setOpen(true);
        }}
      >
        New announcement
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="New announcement"
        description="Students on the course see it here and in their notifications."
        footer={
          <Button type="submit" form={formId} variant="primary" block loading={busy}>
            Post
          </Button>
        }
      >
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void run(async () => {
              await api<typeof content.createAnnouncement>(
                "POST",
                "/course-offerings/:id/announcements",
                {
                  params: { id: offeringId },
                  body: {
                    title: formText(data, "title"),
                    bodyMd: formText(data, "bodyMd"),
                    pinned: data.get("pinned") === "on",
                  },
                  headers: { "idempotency-key": crypto.randomUUID() },
                },
              );
              await queryClient.invalidateQueries({ queryKey: announcementsKey(offeringId) });
              setOpen(false);
            });
          }}
        >
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          <TextField name="title" label="Title" required error={fieldErrors.title} />
          <TextField
            name="bodyMd"
            label="Message (Markdown)"
            multiline
            rows={4}
            required
            error={fieldErrors.bodyMd}
          />
          <Checkbox name="pinned" label="Pin to the top" />
        </form>
      </Sheet>
    </>
  );
}

function AnnouncementItem({
  announcement: a,
  manage,
  offeringId,
}: {
  announcement: Announcement;
  manage: boolean;
  offeringId: string;
}) {
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  const [deleting, setDeleting] = useState(false);
  const params = { id: a.id };
  const refresh = () => queryClient.invalidateQueries({ queryKey: announcementsKey(offeringId) });
  return (
    <div role="listitem" aria-label={a.title} className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-subhead text-ink">{a.title}</p>
        {a.pinned ? <Badge tone="brand">Pinned</Badge> : null}
      </div>
      <p className="text-meta text-ink-muted">
        {a.authorName} · <Time value={a.publishedAt} />
      </p>
      <SafeHtml html={a.bodyHtml} />
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {manage ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() =>
              void run(async () => {
                await api<typeof content.updateAnnouncement>("PATCH", "/announcements/:id", {
                  params,
                  body: { pinned: !a.pinned },
                  headers: { "if-match": `"${String(a.version)}"` },
                });
                await refresh();
              })
            }
          >
            {a.pinned ? "Unpin" : "Pin"}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setDeleting(true);
            }}
          >
            Delete
          </Button>
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title="Delete this announcement?"
            confirmLabel="Delete announcement"
            tone="danger"
            onConfirm={async () => {
              await api<typeof content.deleteAnnouncement>("DELETE", "/announcements/:id", {
                params,
              });
              setDeleting(false);
              await refresh();
            }}
          >
            "{a.title}" is removed from the course for everyone. This can't be undone.
          </ConfirmDialog>
        </div>
      ) : null}
    </div>
  );
}
