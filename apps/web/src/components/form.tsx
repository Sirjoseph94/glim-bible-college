import type { InputHTMLAttributes, ReactNode } from "react";

export function Field(
  props: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined },
) {
  const { label, error, id, ...input } = props;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        className="block w-full rounded border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id ?? ""}-error` : undefined}
        {...input}
      />
      {error ? (
        <p id={`${id ?? ""}-error`} className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded bg-brand px-4 py-2 font-medium text-white disabled:opacity-60"
    >
      {busy ? "Please wait…" : children}
    </button>
  );
}

export function Alert({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const colours =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-green-200 bg-green-50 text-green-800";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded border px-3 py-2 text-sm ${colours}`}
    >
      {children}
    </div>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A text field's value from a submitted form ("" when absent). */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
