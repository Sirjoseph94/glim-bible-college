import type { Announcement, BodyOf, content, Material } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../api/client";
import { Alert, Field, formText } from "./form";
import { Time } from "./time";
import { uploadFile } from "./upload";
import { useSubmit } from "./use-submit";

const materialsKey = (offeringId: string) => ["materials", offeringId];
const announcementsKey = (offeringId: string) => ["announcements", offeringId];

function size(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** HTML from the server, rendered from Markdown and sanitized there with an allow-list (§14.1). */
function SafeHtml({ html }: { html: string }) {
  return (
    <div
      className="prose-sm space-y-2 [&_a]:text-blue-700 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      // Sanitized on the server (renderMarkdown), so it is safe to insert as it is.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function MaterialBody({ material: m }: { material: Material }) {
  if (m.kind === "FILE" && m.file !== null)
    return (
      <a href={m.file.downloadPath} className="text-blue-700 underline">
        Download {m.file.name} ({size(m.file.sizeBytes)})
      </a>
    );
  if (m.kind === "LINK" && m.url !== null)
    return (
      <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
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
    <div className="space-y-3 text-sm">
      {list.isError ? <Alert tone="error">We couldn't load the materials.</Alert> : null}
      {list.isSuccess && items.length === 0 ? (
        <p className="text-slate-600">No materials yet.</p>
      ) : null}
      {[...sections].map(([label, materials]) => (
        <section key={label} className="space-y-2">
          <h4 className="font-medium text-slate-700">{label}</h4>
          <ul className="space-y-2">
            {materials.map((m) => (
              <MaterialItem key={m.id} material={m} manage={manage} offeringId={offeringId} />
            ))}
          </ul>
        </section>
      ))}
      {manage ? <AddMaterial offeringId={offeringId} /> : null}
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
  const { busy, error, run } = useSubmit();
  const notes = [
    m.status === "DRAFT" ? "draft" : null,
    m.visibility === "STAFF_ONLY" ? "staff only" : null,
  ].filter((n) => n !== null);
  return (
    <li className="space-y-1 rounded border border-slate-200 p-2" aria-label={m.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {m.title}
          {notes.length > 0 ? (
            <span className="font-normal text-slate-500"> ({notes.join(", ")})</span>
          ) : null}
        </span>
        {manage ? (
          <button
            type="button"
            disabled={busy}
            className="text-red-700 underline"
            onClick={() =>
              void run(async () => {
                await api<typeof content.deleteMaterial>("DELETE", "/course-materials/:id", {
                  params: { id: m.id },
                });
                await queryClient.invalidateQueries({ queryKey: materialsKey(offeringId) });
              })
            }
          >
            Remove
          </button>
        ) : null}
      </div>
      {manage && m.publishAt !== null && new Date(m.publishAt) > new Date() ? (
        <p className="text-slate-500">
          Shown to students from <Time value={m.publishAt} />
        </p>
      ) : null}
      <MaterialBody material={m} />
      {error ? <Alert tone="error">{error}</Alert> : null}
    </li>
  );
}

function AddMaterial({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const [kind, setKind] = useState<Material["kind"]>("FILE");
  const [progress, setProgress] = useState<number | null>(null);
  const [formKey, setFormKey] = useState(0);
  const id = useId();

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
      setProgress(null);
      setFormKey((k) => k + 1);
    }).finally(() => {
      setProgress(null);
    });
  };

  return (
    <form
      key={formKey}
      className="space-y-2 rounded border border-dashed border-slate-300 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
    >
      <p className="font-medium">Add material</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-3" role="radiogroup" aria-label="Kind">
        {(["FILE", "LINK", "TEXT"] as const).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <input
              type="radio"
              name="kind"
              checked={kind === k}
              onChange={() => {
                setKind(k);
              }}
            />
            {k === "FILE" ? "File" : k === "LINK" ? "Link" : "Text"}
          </label>
        ))}
      </div>
      <Field id={`${id}-title`} name="title" label="Title" required error={fieldErrors.title} />
      <Field
        id={`${id}-section`}
        name="sectionLabel"
        label="Section (optional), e.g. Week 1"
        error={fieldErrors.sectionLabel}
      />
      {kind === "FILE" ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-file`} className="block font-medium text-slate-700">
            File (up to 100 MB)
          </label>
          <input id={`${id}-file`} name="file" type="file" required />
          {progress !== null ? (
            <progress className="w-full" value={progress} max={1} aria-label="Upload progress" />
          ) : null}
        </div>
      ) : kind === "LINK" ? (
        <Field
          id={`${id}-url`}
          name="url"
          label="Web address"
          type="url"
          required
          error={fieldErrors.url}
        />
      ) : (
        <div className="space-y-1">
          <label htmlFor={`${id}-body`} className="block font-medium text-slate-700">
            Text (Markdown)
          </label>
          <textarea
            id={`${id}-body`}
            name="bodyMd"
            required
            rows={5}
            className="block w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
      )}
      <Field
        id={`${id}-publish`}
        name="publishAt"
        type="datetime-local"
        label="Show to students from (optional)"
      />
      <label className="flex items-center gap-2">
        <input type="checkbox" name="staffOnly" /> Staff only
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
      >
        Add material
      </button>
    </form>
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
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const [formKey, setFormKey] = useState(0);
  const id = useId();
  const list = useQuery({
    queryKey: announcementsKey(offeringId),
    queryFn: ({ signal }) =>
      api<typeof content.listAnnouncements>("GET", "/course-offerings/:id/announcements", {
        params: { id: offeringId },
        signal,
      }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: announcementsKey(offeringId) });
  const items = list.data?.items ?? [];
  return (
    <div className="space-y-3 text-sm">
      {list.isSuccess && items.length === 0 ? (
        <p className="text-slate-600">No announcements yet.</p>
      ) : null}
      <ul className="space-y-2">
        {items.map((a) => (
          <AnnouncementItem
            key={a.id}
            announcement={a}
            manage={manage}
            busy={busy}
            act={(action) =>
              void run(async () => {
                await action();
                await refresh();
              })
            }
          />
        ))}
      </ul>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {manage ? (
        <form
          key={formKey}
          className="space-y-2 rounded border border-dashed border-slate-300 p-2"
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
              await refresh();
              setFormKey((k) => k + 1);
            });
          }}
        >
          <p className="font-medium">Post an announcement</p>
          <Field id={`${id}-title`} name="title" label="Title" required error={fieldErrors.title} />
          <label htmlFor={`${id}-body`} className="block font-medium text-slate-700">
            Message (Markdown)
          </label>
          <textarea
            id={`${id}-body`}
            name="bodyMd"
            required
            rows={4}
            className="block w-full rounded border border-slate-300 px-3 py-2"
          />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="pinned" /> Pin to the top
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
          >
            Post
          </button>
        </form>
      ) : null}
    </div>
  );
}

function AnnouncementItem({
  announcement: a,
  manage,
  busy,
  act,
}: {
  announcement: Announcement;
  manage: boolean;
  busy: boolean;
  act: (action: () => Promise<unknown>) => void;
}) {
  const params = { id: a.id };
  return (
    <li className="space-y-1 rounded border border-slate-200 p-2" aria-label={a.title}>
      <div className="font-medium">
        {a.pinned ? "📌 " : null}
        {a.title}
      </div>
      <div className="text-xs text-slate-500">
        {a.authorName} · <Time value={a.publishedAt} />
      </div>
      <SafeHtml html={a.bodyHtml} />
      {manage ? (
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            className="underline"
            onClick={() => {
              act(() =>
                api<typeof content.updateAnnouncement>("PATCH", "/announcements/:id", {
                  params,
                  body: { pinned: !a.pinned },
                  headers: { "if-match": `"${String(a.version)}"` },
                }),
              );
            }}
          >
            {a.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            disabled={busy}
            className="text-red-700 underline"
            onClick={() => {
              act(() =>
                api<typeof content.deleteAnnouncement>("DELETE", "/announcements/:id", { params }),
              );
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </li>
  );
}
